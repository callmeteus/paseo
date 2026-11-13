import { randomUUID } from "node:crypto";
import type {
  DaemonPermission,
  McpBridge,
  McpBridgeTool,
  McpServerConfig,
  SessionInboundMessage,
  SessionOutboundMessage,
} from "@getpaseo/protocol/messages";
import type { ConnectedHosts } from "../connected-hosts/index.js";

const BRIDGE_PERMISSIONS: DaemonPermission[] = ["daemon.read", "daemon.manage"];
const REQUEST_TIMEOUT_MS = 30_000;
const TOOL_CACHE_MS = 30_000;

interface BridgeToolsCache {
  tools: McpBridgeTool[];
  expiresAt: number;
}

interface RouteSession {
  send(data: string): void;
  close(): void;
}

interface RequestWaiter {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface McpBridgeManagerOptions {
  hosts: ConnectedHosts;
  selfServerId: string;
  getBridges: () => Record<string, McpBridge>;
}

export class McpBridgeManager {
  private baseUrl: string | null = null;
  private authToken: string | null = null;
  private readonly toolsCache = new Map<string, BridgeToolsCache>();

  constructor(private readonly options: McpBridgeManagerOptions) {}

  setBaseUrl(url: string | null): void {
    this.baseUrl = url;
  }

  setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  invalidate(bridgeName?: string): void {
    if (bridgeName) {
      this.toolsCache.delete(bridgeName);
    } else {
      this.toolsCache.clear();
    }
  }

  async listTools(bridgeName: string): Promise<McpBridgeTool[]> {
    const cached = this.toolsCache.get(bridgeName);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.tools;
    }
    const client = await this.openBridgeClient(bridgeName);
    try {
      const response = await client.request<{
        server: string;
        tools: McpBridgeTool[];
        error: string | null;
      }>({
        type: "mcp.bridge.list_tools.request",
        requestId: randomUUID(),
        server: this.requireBridge(bridgeName).server,
      });
      if (response.error) throw new Error(response.error);
      this.toolsCache.set(bridgeName, {
        tools: response.tools,
        expiresAt: Date.now() + TOOL_CACHE_MS,
      });
      return response.tools;
    } finally {
      client.close();
    }
  }

  async callTool(
    bridgeName: string,
    toolName: string,
    args: Record<string, unknown> | undefined,
  ): Promise<unknown> {
    const client = await this.openBridgeClient(bridgeName);
    try {
      const response = await client.request<{
        result: unknown;
        error: string | null;
      }>({
        type: "mcp.bridge.call_tool.request",
        requestId: randomUUID(),
        server: this.requireBridge(bridgeName).server,
        tool: toolName,
        ...(args ? { arguments: args } : {}),
      });
      if (response.error) throw new Error(response.error);
      return response.result;
    } finally {
      client.close();
    }
  }

  async listServers(input: {
    host: string;
    via?: string;
  }): Promise<Array<{ server: string; description?: string | null; tools?: string[] }>> {
    const client = await this.openClientTo({ host: input.host, via: input.via });
    try {
      const response = await client.request<{
        servers: Array<{ server: string; description?: string | null; tools?: string[] }>;
        error: string | null;
      }>({
        type: "mcp.bridge.list_servers.request",
        requestId: randomUUID(),
      });
      if (response.error) throw new Error(response.error);
      return response.servers;
    } finally {
      client.close();
    }
  }

  getAgentMcpServers(agentId: string): Record<string, McpServerConfig> {
    if (!this.baseUrl || !this.authToken) {
      return {};
    }
    const bridges = this.options.getBridges();
    const servers: Record<string, McpServerConfig> = {};
    for (const bridgeName of Object.keys(bridges)) {
      servers[bridgeName] = {
        type: "http",
        url: `${this.baseUrl}/mcp/bridge/${encodeURIComponent(bridgeName)}?callerAgentId=${encodeURIComponent(agentId)}`,
        headers: { Authorization: `Bearer ${this.authToken}` },
      };
    }
    return servers;
  }

  private requireBridge(bridgeName: string): McpBridge {
    const bridge = this.options.getBridges()[bridgeName];
    if (!bridge) {
      throw new Error(`Unknown MCP bridge "${bridgeName}"`);
    }
    return bridge;
  }

  private async openBridgeClient(bridgeName: string): Promise<RoutedSessionClient> {
    const bridge = this.requireBridge(bridgeName);
    return this.openClientTo({ host: bridge.host, ...(bridge.via ? { via: bridge.via } : {}) });
  }

  private async openClientTo(input: { host: string; via?: string }): Promise<RoutedSessionClient> {
    if (input.via) {
      const outer = await this.openDirectClient(input.via);
      try {
        const nested = await outer.openNestedRoute(input.host);
        return nested;
      } catch (error) {
        outer.close();
        throw error;
      }
    }
    return this.openDirectClient(input.host);
  }

  private async openDirectClient(host: string): Promise<RoutedSessionClient> {
    const controller = new AbortController();
    let client: RoutedSessionClient | null = null;
    const pendingFrames: Array<string | Uint8Array> = [];
    let endedCode: string | null = null;
    let endedMessage = "";
    const route = await this.options.hosts.openRoute({
      serverId: host,
      scopeId: `mcp-bridge-${randomUUID()}`,
      sourceId: "mcp-bridge",
      originSessionId: `mcp-bridge-${randomUUID()}`,
      originServerId: this.options.selfServerId,
      hopPath: [this.options.selfServerId],
      maxHops: 3,
      permissions: BRIDGE_PERMISSIONS,
      signal: controller.signal,
      frame: (data) => {
        if (!client) pendingFrames.push(data);
        else client.handleFrame(data);
      },
      ended: (code, message) => {
        if (!client) {
          endedCode = code;
          endedMessage = message;
          return;
        }
        client.handleEnded(code, message);
      },
    });
    client = new RoutedSessionClient(route, (reason) => {
      controller.abort();
      void reason;
    });
    client.sendHello();
    for (const frame of pendingFrames) client.handleFrame(frame);
    if (endedCode) client.handleEnded(endedCode, endedMessage);
    await client.waitForServerInfo();
    return client;
  }
}

class RoutedSessionClient {
  private readonly waiters = new Map<string, RequestWaiter>();
  private readonly nested = new Map<string, RoutedSessionClient>();
  private readonly serverInfo = createDeferred<void>();
  private closed = false;

  constructor(
    private readonly route: RouteSession,
    private readonly onClose: (reason: string) => void,
  ) {}

  sendHello(): void {
    this.route.send(
      JSON.stringify({
        type: "hello",
        clientId: `mcp-bridge-${randomUUID()}`,
        clientType: "mcp",
        protocolVersion: 1,
        appVersion: "0.13.1",
      }),
    );
  }

  async waitForServerInfo(): Promise<void> {
    await withTimeout(this.serverInfo.promise, REQUEST_TIMEOUT_MS, "MCP bridge handshake");
  }

  async request<T>(message: SessionInboundMessage): Promise<T> {
    const requestId =
      "requestId" in message && typeof message.requestId === "string"
        ? message.requestId
        : randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(requestId);
        reject(new Error(`MCP bridge request timed out: ${message.type}`));
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();
      this.waiters.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.sendSessionMessage(message);
    });
  }

  async openNestedRoute(serverId: string): Promise<RoutedSessionClient> {
    const requestId = randomUUID();
    const response = await this.request<{ routeId: string }>({
      type: "hosts.route.open.request",
      requestId,
      serverId,
      scopeId: `mcp-bridge-nested-${requestId}`,
    });
    const nested = new RoutedSessionClient(
      {
        send: (data) => {
          this.sendSessionMessage({
            type: "hosts.route.frame.request",
            routeId: response.routeId,
            data,
            binary: false,
          });
        },
        close: () => {
          try {
            this.sendSessionMessage({
              type: "hosts.route.close.request",
              routeId: response.routeId,
            });
          } catch {
            // The outer route may already be closed.
          }
          this.nested.delete(response.routeId);
        },
      },
      () => {
        this.close();
      },
    );
    this.nested.set(response.routeId, nested);
    nested.sendHello();
    await nested.waitForServerInfo();
    return nested;
  }

  handleFrame(data: string | Uint8Array): void {
    if (this.closed || typeof data !== "string") return;
    let envelope: unknown;
    try {
      envelope = JSON.parse(data);
    } catch {
      return;
    }
    if (!isRecord(envelope) || envelope.type !== "session" || !isRecord(envelope.message)) {
      return;
    }
    const message = envelope.message as SessionOutboundMessage;
    if (message.type === "hosts.route.frame") {
      const nested = this.nested.get(message.payload.subscriptionId);
      if (nested) nested.handleFrame(message.payload.data);
      return;
    }
    if (message.type === "status" && message.payload.status === "server_info") {
      this.serverInfo.resolve();
      return;
    }
    if (message.type === "rpc_error") {
      const waiter = this.waiters.get(message.payload.requestId);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.waiters.delete(message.payload.requestId);
        waiter.reject(new Error(message.payload.error));
      }
      return;
    }
    if (!("payload" in message)) return;
    const payload = message.payload as Record<string, unknown> | undefined;
    if (!payload) return;
    const requestId = payload.requestId;
    if (typeof requestId !== "string") return;
    const waiter = this.waiters.get(requestId);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.waiters.delete(requestId);
    waiter.resolve(payload);
  }

  handleEnded(_code: string, message: string): void {
    this.close(message);
  }

  close(reason = "MCP bridge route closed"): void {
    if (this.closed) return;
    this.closed = true;
    this.route.close();
    for (const waiter of this.waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
    this.waiters.clear();
    for (const nested of this.nested.values()) nested.close(reason);
    this.nested.clear();
    this.serverInfo.reject(new Error(reason));
    this.onClose(reason);
  }

  private sendSessionMessage(message: SessionInboundMessage): void {
    if (this.closed) throw new Error("MCP bridge route is closed");
    this.route.send(JSON.stringify({ type: "session", message }));
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
