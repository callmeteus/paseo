import { appendFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CancelledNotificationSchema,
  ElicitRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  PingRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const log = (...args) => {
  try {
    appendFileSync(
      process.env.PASEO_MCP_PROXY_LOG ?? "/tmp/opencode/mcp-proxy.log",
      args.map(String).join(" ") + "\n",
    );
  } catch {}
};
const config = JSON.parse(
  Buffer.from(process.env.PASEO_MCP_PROXY_CONFIG ?? "", "base64").toString("utf8"),
);
const callback = process.env.PASEO_MCP_PROXY_CALLBACK ?? "";
const token = process.env.PASEO_MCP_PROXY_TOKEN ?? "";

function transport() {
  if (config.type === "stdio") {
    return new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: config.env ? { ...process.env, ...config.env } : process.env,
    });
  }
  const url = new URL(config.url);
  const options = config.headers ? { requestInit: { headers: config.headers } } : undefined;
  return config.type === "sse"
    ? new SSEClientTransport(url, options)
    : new StreamableHTTPClientTransport(url, options);
}

const upstream = new Client(
  { name: "paseo-mcp-proxy", version: "1.0.0" },
  { capabilities: { elicitation: { form: {}, url: {} } } },
);
const cancelEndpoint = callback.replace(/\/elicit$/, "/elicit-cancel");
const outstandingElicitations = new Set();
const notifyCancelled = (id, reason) => {
  if (id === undefined || id === null) return;
  outstandingElicitations.delete(String(id));
  return fetch(cancelEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, request: { id: String(id), reason } }),
  }).catch((error) => log("[paseo-proxy] cancel callback failed", String(error)));
};
upstream.setNotificationHandler(CancelledNotificationSchema, (notification) => {
  notifyCancelled(notification.params?.requestId, "cancelled");
});
// The MCP SDK Client is an EventEmitter-like Protocol with an `onclose`
// callback; it has no addEventListener. Use the supported hook or the shim
// crashes at startup and every wrapped MCP server fails to connect.
// oxlint-disable-next-line unicorn/prefer-add-event-listener -- MCP Client has no addEventListener
upstream.onclose = () => {
  for (const id of outstandingElicitations) notifyCancelled(id, "closed");
};
upstream.setRequestHandler(ElicitRequestSchema, async (request, extra) => {
  const id = extra.requestId;
  const key = String(id);
  log(
    "[paseo-proxy] elicitation received",
    JSON.stringify(request.params?.message ?? "").slice(0, 120),
  );
  outstandingElicitations.add(key);
  extra.signal.addEventListener("abort", () => notifyCancelled(id, "aborted"), { once: true });
  try {
    const response = await fetch(callback, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, request: { id: key, params: request.params } }),
    });
    if (!response.ok) {
      log("[paseo-proxy] callback failed", response.status);
      return { action: "cancel" };
    }
    const answer = await response.json();
    log("[paseo-proxy] elicitation answered", answer?.action);
    return answer;
  } catch (error) {
    // Daemon unreachable: never hang the tool; relay everything else.
    log("[paseo-proxy] callback unreachable", String(error));
    return { action: "cancel" };
  } finally {
    outstandingElicitations.delete(key);
  }
});
await upstream.connect(transport());

const proxy = new Server(
  { name: config.name ?? "paseo-proxy", version: "1.0.0" },
  {
    capabilities: { tools: {}, resources: {}, prompts: {} },
  },
);
proxy.setRequestHandler(PingRequestSchema, async () => ({}));
proxy.setRequestHandler(ListToolsRequestSchema, async (request) =>
  upstream.listTools(request.params),
);
proxy.setRequestHandler(CallToolRequestSchema, async (request) => {
  const result = await upstream.callTool(request.params);
  try {
    await fetch(callback.replace(/\/elicit$/, "/tool-result"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, result }),
    });
  } catch (error) {
    log("[paseo-proxy] tool-result error", String(error));
    /* bridge may be closed */
  }
  return result;
});
proxy.setRequestHandler(ListResourcesRequestSchema, async (request) =>
  upstream.listResources(request.params),
);
proxy.setRequestHandler(ReadResourceRequestSchema, async (request) =>
  upstream.readResource(request.params),
);
proxy.setRequestHandler(ListPromptsRequestSchema, async (request) =>
  upstream.listPrompts(request.params),
);
proxy.setRequestHandler(GetPromptRequestSchema, async (request) =>
  upstream.getPrompt(request.params),
);
await proxy.connect(new StdioServerTransport());
