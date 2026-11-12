import type { McpServerConfig } from "@getpaseo/protocol/messages";

export interface McpBridgeManager {
  getAgentMcpServers(agentId: string): Record<string, McpServerConfig> | undefined;
}
