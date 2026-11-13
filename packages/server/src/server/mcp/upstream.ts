import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig } from "@getpaseo/protocol/messages";
import type { McpBridgeTool } from "@getpaseo/protocol/messages";

const CONNECT_TIMEOUT_MS = 15_000;
const TOOL_TIMEOUT_MS = 60_000;

interface ConnectedUpstream {
  client: Client;
  configKey: string;
  tools: McpBridgeTool[];
}

export interface UpstreamMcpRegistryOptions {
  getServers: () => Record<string, McpServerConfig>;
  logger?: {
    warn(...args: unknown[]): void;
    info(...args: unknown[]): void;
  };
}

export class UpstreamMcpRegistry {
  private readonly upstreams = new Map<string, ConnectedUpstream>();
  private readonly connecting = new Map<string, Promise<ConnectedUpstream>>();

  constructor(private readonly options: UpstreamMcpRegistryOptions) {}

  async listTools(serverName: string): Promise<McpBridgeTool[]> {
    const upstream = await this.getUpstream(serverName);
    return upstream.tools;
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> | undefined,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const upstream = await this.getUpstream(serverName);
    return upstream.client.callTool({ name: toolName, arguments: args ?? {} }, undefined, {
      timeout: TOOL_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    });
  }

  async testConfig(config: McpServerConfig): Promise<{ tools: string[] }> {
    const client = new Client({ name: "paseo-mcp-test", version: "1.0.0" }, { capabilities: {} });
    const transport = createTransport(config);
    try {
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, "MCP test");
      const tools = await this.readTools(client);
      return { tools: tools.map((tool) => tool.name) };
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  invalidate(serverName: string): void {
    const upstream = this.upstreams.get(serverName);
    this.upstreams.delete(serverName);
    this.connecting.delete(serverName);
    void upstream?.client.close().catch(() => undefined);
  }

  invalidateAll(): void {
    for (const name of this.upstreams.keys()) {
      this.invalidate(name);
    }
  }

  async close(): Promise<void> {
    const upstreams = [...this.upstreams.values()];
    this.upstreams.clear();
    this.connecting.clear();
    await Promise.allSettled(upstreams.map((entry) => entry.client.close()));
  }

  private async getUpstream(serverName: string): Promise<ConnectedUpstream> {
    const config = this.options.getServers()[serverName];
    if (!config) {
      throw new Error(`Unknown MCP server "${serverName}"`);
    }
    const configKey = JSON.stringify(config);
    const cached = this.upstreams.get(serverName);
    if (cached && cached.configKey === configKey) {
      return cached;
    }
    if (cached) {
      this.invalidate(serverName);
    }
    const pending = this.connecting.get(serverName);
    if (pending) {
      return pending;
    }
    const connection = this.connect(serverName, config, configKey).finally(() => {
      this.connecting.delete(serverName);
    });
    this.connecting.set(serverName, connection);
    return connection;
  }

  private async connect(
    serverName: string,
    config: McpServerConfig,
    configKey: string,
  ): Promise<ConnectedUpstream> {
    const client = new Client({ name: "paseo-mcp-bridge", version: "1.0.0" }, { capabilities: {} });
    const transport = createTransport(config);
    try {
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, serverName);
      const tools = await this.readTools(client);
      const upstream: ConnectedUpstream = { client, configKey, tools };
      this.upstreams.set(serverName, upstream);
      return upstream;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw new Error(
        `MCP server "${serverName}" is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  private async readTools(client: Client): Promise<McpBridgeTool[]> {
    const tools: McpBridgeTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      for (const tool of page.tools) {
        tools.push({
          name: tool.name,
          ...(tool.description ? { description: tool.description } : {}),
          inputSchema: tool.inputSchema,
        });
      }
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }
}

function createTransport(config: McpServerConfig) {
  if (config.type === "stdio") {
    return new StdioClientTransport({
      command: config.command,
      ...(config.args ? { args: config.args } : {}),
      ...(config.cwd ? { cwd: config.cwd } : {}),
      env: config.env ? { ...getDefaultEnvironment(), ...config.env } : undefined,
    });
  }
  const url = new URL(config.url);
  if (config.type === "sse") {
    return new SSEClientTransport(url, {
      requestInit: config.headers ? { headers: config.headers } : undefined,
    });
  }
  return new StreamableHTTPClientTransport(url, {
    requestInit: config.headers ? { headers: config.headers } : undefined,
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
