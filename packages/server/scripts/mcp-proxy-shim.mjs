import { appendFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
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
upstream.setRequestHandler(ElicitRequestSchema, async (request) => {
  log(
    "[paseo-proxy] elicitation received",
    JSON.stringify(request.params?.message ?? "").slice(0, 120),
  );
  const response = await fetch(callback, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, request }),
  });
  if (!response.ok) {
    log("[paseo-proxy] callback failed", response.status);
    return { action: "decline" };
  }
  const answer = await response.json();
  log("[paseo-proxy] elicitation answered", answer?.action);
  return answer;
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
proxy.setRequestHandler(CallToolRequestSchema, async (request) =>
  upstream.callTool(request.params),
);
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
