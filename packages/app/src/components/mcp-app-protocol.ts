/**
 * The MCP Apps handshake a host answers for an HTML view. Kept pure so both
 * the web iframe and the native WebView send the same messages.
 */
export function mcpAppHostMessages(
  message: unknown,
  tool: { name: string; input: unknown; result: unknown },
): Array<Record<string, unknown>> | null {
  if (typeof message !== "object" || message === null) return null;
  const request = message as Record<string, unknown>;
  if (
    request.jsonrpc !== "2.0" ||
    request.method !== "ui/initialize" ||
    typeof request.id !== "number"
  ) {
    return null;
  }
  return [
    {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        hostContext: {
          toolInfo: { tool: { name: tool.name, originalName: tool.name } },
          theme: "dark",
        },
      },
    },
    {
      jsonrpc: "2.0",
      method: "ui/notifications/tool-input",
      params: { arguments: tool.input ?? {} },
    },
    {
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: tool.result ?? null,
    },
  ];
}
