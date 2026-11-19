const frameStyle = {
  border: 0,
  width: "100%",
  height: "100%",
  background: "transparent",
} as const;

/**
 * Web/Electron frame for an MCP App resource. `sandbox` without
 * `allow-same-origin` keeps the page in an opaque origin while still letting
 * its own scripts run.
 */
export function McpAppFrame({ html }: { html: string }) {
  return (
    <iframe
      title="MCP app"
      data-testid="mcp-app-frame"
      srcDoc={html}
      sandbox="allow-scripts"
      style={frameStyle}
    />
  );
}
