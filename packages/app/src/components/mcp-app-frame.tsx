import { useMemo } from "react";
import { WebView } from "react-native-webview";

const frameStyle = { flex: 1 } as const;

/** Native frame for an MCP App's HTML resource. Scripts are kept off: the view is a result page. */
export function McpAppFrame({ html }: { html: string }) {
  const source = useMemo(() => ({ html }), [html]);
  return (
    <WebView
      source={source}
      style={frameStyle}
      javaScriptEnabled={false}
      domStorageEnabled={false}
      testID="mcp-app-frame"
    />
  );
}
