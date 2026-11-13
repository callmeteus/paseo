import type { McpBridgeServer, McpBridgeTool, McpShare } from "@getpaseo/protocol/messages";
import type { UpstreamMcpRegistry } from "./upstream.js";

export interface McpBridgeAuthority {
  listServers(input: { originServerId: string; includeAll?: boolean }): Promise<McpBridgeServer[]>;
  listTools(input: {
    serverName: string;
    originServerId: string;
    includeAll?: boolean;
  }): Promise<McpBridgeTool[]>;
  callTool(input: {
    serverName: string;
    toolName: string;
    arguments: Record<string, unknown> | undefined;
    originServerId: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
}

export class SharedMcpAuthority implements McpBridgeAuthority {
  constructor(
    private readonly upstream: UpstreamMcpRegistry,
    private readonly getShares: () => Record<string, McpShare>,
  ) {}

  async listServers(input: {
    originServerId: string;
    includeAll?: boolean;
  }): Promise<McpBridgeServer[]> {
    const shares = this.getShares();
    const servers: McpBridgeServer[] = [];
    for (const [serverName, share] of Object.entries(shares)) {
      if (!input.includeAll && !isAllowed(share, input.originServerId)) continue;
      servers.push({
        server: serverName,
        ...(share.tools ? { tools: share.tools } : {}),
      });
    }
    return servers.sort((left, right) => left.server.localeCompare(right.server));
  }

  async listTools(input: {
    serverName: string;
    originServerId: string;
    includeAll?: boolean;
  }): Promise<McpBridgeTool[]> {
    const share = this.requireShare(input.serverName, input.originServerId, input.includeAll);
    const tools = await this.upstream.listTools(input.serverName);
    return share.tools ? tools.filter((tool) => share.tools?.includes(tool.name)) : tools;
  }

  async callTool(input: {
    serverName: string;
    toolName: string;
    arguments: Record<string, unknown> | undefined;
    originServerId: string;
    signal?: AbortSignal;
  }): Promise<unknown> {
    const share = this.requireShare(input.serverName, input.originServerId);
    if (share.tools && !share.tools.includes(input.toolName)) {
      throw new Error(`Tool "${input.toolName}" is not shared from "${input.serverName}"`);
    }
    return this.upstream.callTool(input.serverName, input.toolName, input.arguments, input.signal);
  }

  private requireShare(serverName: string, originServerId: string, includeAll = false): McpShare {
    const share = this.getShares()[serverName];
    if (!share || (!includeAll && !isAllowed(share, originServerId))) {
      throw new Error(`MCP server "${serverName}" is not shared with this host`);
    }
    return share;
  }
}

function isAllowed(share: McpShare, originServerId: string): boolean {
  return originServerId.length > 0 && share.hosts.includes(originServerId);
}
