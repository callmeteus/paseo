interface McpServersCapabilities {
  mcpServers?: boolean;
}

export function supportsMcpServers(features: McpServersCapabilities | undefined): boolean {
  return features?.mcpServers === true;
}