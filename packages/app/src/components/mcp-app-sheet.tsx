import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { McpAppFrame } from "@/components/mcp-app-frame";

const bodyStyle = { flex: 1, minHeight: 420 } as const;

/** Shows the HTML resource an MCP server ships for a tool result. */
export function McpAppSheet({ html, onClose }: { html: string; onClose: () => void }) {
  const { t } = useTranslation();
  const handleClose = useCallback(() => onClose(), [onClose]);
  const header = useMemo(() => ({ title: t("agentStream.viewMcpApp") }), [t]);
  return (
    <AdaptiveModalSheet
      visible
      onClose={handleClose}
      header={header}
      desktopMaxWidth={860}
      testID="mcp-app-sheet"
    >
      <View style={bodyStyle}>
        <McpAppFrame html={html} />
      </View>
    </AdaptiveModalSheet>
  );
}
