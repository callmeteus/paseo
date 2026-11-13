import { useCallback, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { DetectedMcpServer } from "@getpaseo/protocol/messages";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";

const ThemedCheck = withUnistyles(Check);
const checkColorMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });

interface McpImportSheetProps {
  servers: DetectedMcpServer[];
  errors: string[];
  selected: ReadonlySet<string>;
  isImporting: boolean;
  onToggle: (server: DetectedMcpServer) => void;
  onImport: () => void;
}

export function McpImportSheet({
  servers,
  errors,
  selected,
  isImporting,
  onToggle,
  onImport,
}: McpImportSheetProps): ReactElement {
  const { t } = useTranslation();
  const groups = useMemo(() => {
    const map = new Map<string, DetectedMcpServer[]>();
    for (const server of servers) {
      const list = map.get(server.source) ?? [];
      list.push(server);
      map.set(server.source, list);
    }
    return [...map.entries()];
  }, [servers]);

  if (servers.length === 0 && errors.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{t("settings.host.mcp.import.emptyTitle")}</Text>
        <Text style={styles.hint}>{t("settings.host.mcp.import.emptyDescription")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {groups.map(([source, group]) => (
        <View key={source} style={styles.group}>
          <Text style={styles.groupTitle}>{t(`settings.host.mcp.import.sources.${source}`)}</Text>
          <View style={settingsStyles.card}>
            {group.map((server, index) => (
              <DetectedServerRow
                key={`${source}:${server.sourcePath}:${server.name}`}
                server={server}
                isFirst={index === 0}
                selected={selected.has(serverId(server))}
                onToggle={onToggle}
              />
            ))}
          </View>
        </View>
      ))}
      {errors.length > 0 ? <Text style={styles.error}>{errors.join("\n")}</Text> : null}
      <View style={styles.actions}>
        <Button onPress={onImport} disabled={selected.size === 0 || isImporting}>
          {isImporting
            ? t("settings.host.mcp.import.importing")
            : t("settings.host.mcp.import.importCount", { count: selected.size })}
        </Button>
      </View>
    </View>
  );
}

function DetectedServerRow({
  server,
  isFirst,
  selected,
  onToggle,
}: {
  server: DetectedMcpServer;
  isFirst: boolean;
  selected: boolean;
  onToggle: (server: DetectedMcpServer) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handleToggle = useCallback(() => onToggle(server), [onToggle, server]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <PressHighlight
      onPress={handleToggle}
      highlightStyle={styles.rowHighlight}
      style={[settingsStyles.row, !isFirst && settingsStyles.rowBorder]}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{server.name}</Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {server.transport} · {server.sourcePath}
        </Text>
        {server.alreadyConfigured ? (
          <Text style={styles.already}>{t("settings.host.mcp.import.alreadyConfigured")}</Text>
        ) : null}
        {server.warnings.length > 0 ? (
          <Text style={styles.warning}>{server.warnings.join(" ")}</Text>
        ) : null}
      </View>
      <View style={[styles.checkCircle, selected && styles.checkCircleSelected]}>
        {selected ? <ThemedCheck size={14} uniProps={checkColorMapping} /> : null}
      </View>
    </PressHighlight>
  );
}

export function serverId(server: DetectedMcpServer): string {
  return `${server.source}:${server.sourcePath}:${server.name}`;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[4],
  },
  group: {
    gap: theme.spacing[2],
  },
  groupTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginLeft: theme.spacing[1],
  },
  rowHighlight: {
    backgroundColor: theme.colors.surface3,
  },
  empty: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[4],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  already: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize["2xs"],
    marginTop: theme.spacing[1],
  },
  warning: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize["2xs"],
    marginTop: theme.spacing[1],
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkCircleSelected: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
}));
