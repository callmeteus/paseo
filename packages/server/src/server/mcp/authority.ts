import type { McpBridgeServer, McpBridgeTool } from "@getpaseo/protocol/mcp-bridge/rpc-schemas";

export interface McpBridgeListServersInput {
  originServerId: string;
  includeAll: boolean;
}

export interface McpBridgeListToolsInput {
  serverName: string;
  originServerId: string;
  includeAll: boolean;
}

export interface McpBridgeCallToolInput {
  serverName: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  originServerId: string;
}

export interface McpBridgeAuthority {
  listServers(input: McpBridgeListServersInput): Promise<McpBridgeServer[]>;
  listTools(input: McpBridgeListToolsInput): Promise<McpBridgeTool[]>;
  callTool(input: McpBridgeCallToolInput): Promise<unknown>;
}
