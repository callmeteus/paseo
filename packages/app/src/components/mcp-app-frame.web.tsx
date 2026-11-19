import { useEffect, useRef } from "react";
import { mcpAppHostMessages } from "./mcp-app-protocol";

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
      if (event.source !== frame.current?.contentWindow) return;
      const replies = mcpAppHostMessages(event.data, { name: toolName, input, result });
      if (!replies) return;
      for (const reply of replies) {
        frame.current?.contentWindow?.postMessage(reply, "*");
      }
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
