import { useCallback, useMemo, useRef } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { McpAppFrameProps } from "./mcp-app-frame.web";

const frameStyle = { flex: 1 } as const;

/** Native frame for an MCP App resource. */
export function McpAppFrame({ html, input, result, toolName }: McpAppFrameProps) {
  const webview = useRef<WebView>(null);
  const source = useMemo(() => ({ html }), [html]);
  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(event.nativeEvent.data) as Record<string, unknown>;
      } catch {
        return;
      }
      if (message.jsonrpc !== "2.0" || message.method !== "ui/initialize") return;
      if (typeof message.id !== "number") return;
      const send = (payload: Record<string, unknown>) => {
        webview.current?.postMessage(JSON.stringify(payload));
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
    },
    [input, result, toolName],
  );

  return (
    <WebView
      ref={webview}
      source={source}
      style={frameStyle}
      javaScriptEnabled
      domStorageEnabled={false}
      onMessage={onMessage}
      testID="mcp-app-frame"
    />
  );
}
