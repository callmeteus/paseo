export interface McpServersCapabilities {
  mcpServers?: boolean;
  mcpBridge?: boolean;
  mcpBridgeMultiHop?: boolean;
  mcpCatalog?: boolean;
  globalSkills?: boolean;
}

export function supportsMcpServers(features: McpServersCapabilities | undefined): boolean {
  return features?.mcpServers === true;
}

export function supportsMcpBridge(features: McpServersCapabilities | undefined): boolean {
  return features?.mcpBridge === true;
}

export function supportsMcpBridgeMultiHop(features: McpServersCapabilities | undefined): boolean {
  return features?.mcpBridgeMultiHop === true;
}

export function supportsMcpCatalog(features: McpServersCapabilities | undefined): boolean {
  return features?.mcpCatalog === true;
}
