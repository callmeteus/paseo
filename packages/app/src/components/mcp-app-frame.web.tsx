import { useEffect, useRef } from "react";

const frameStyle = {
  border: 0,
  width: "100%",
  height: "100%",
  background: "transparent",
} as const;

export interface McpAppFrameProps {
  html: string;
  input: unknown;
  result: unknown;
  toolName: string;
}

/**
 * Web/Electron frame for an MCP App resource. `sandbox` without
 * `allow-same-origin` keeps the page in an opaque origin. The page speaks the
 * MCP Apps postMessage protocol, so answer `ui/initialize` and hand it the
 * tool call the host already has.
 */
export function McpAppFrame({ html, input, result, toolName }: McpAppFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || message.jsonrpc !== "2.0" || event.source !== frame.current?.contentWindow) {
        return;
      }
      if (message.method !== "ui/initialize" || typeof message.id !== "number") return;
      const send = (payload: Record<string, unknown>) => {
        frame.current?.contentWindow?.postMessage(payload, "*");
      };
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          hostContext: {
            toolInfo: { tool: { name: toolName, originalName: toolName } },
            theme: "dark",
          },
        },
      });
      send({
        jsonrpc: "2.0",
        method: "ui/notifications/tool-input",
        params: { arguments: input ?? {} },
      });
      send({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result ?? null });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [input, result, toolName]);

  return (
    <iframe
      ref={frame}
      title="MCP app"
      data-testid="mcp-app-frame"
      srcDoc={html}
      sandbox="allow-scripts"
      style={frameStyle}
    />
  );
}
