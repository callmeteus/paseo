import { useCallback, useMemo, useRef } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { McpAppFrameProps } from "./mcp-app-frame.web";
import { mcpAppHostMessages } from "./mcp-app-protocol";

const frameStyle = { flex: 1 } as const;

/** Native frame for an MCP App resource. */
export function McpAppFrame({ html, input, result, toolName }: McpAppFrameProps) {
  const webview = useRef<WebView>(null);
  const source = useMemo(() => ({ html }), [html]);
  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: unknown;
      try {
        message = JSON.parse(event.nativeEvent.data) as unknown;
      } catch {
        return;
      }
      const replies = mcpAppHostMessages(message, { name: toolName, input, result });
      for (const reply of replies ?? []) {
        webview.current?.postMessage(JSON.stringify(reply));
      }
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
