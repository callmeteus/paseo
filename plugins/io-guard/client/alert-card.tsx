import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Text, View } from "react-native";
import type { AlertData } from "../shared/contracts.js";

export function IoGuardAlertCard({ item, theme, layout }: PluginTimelineItemProps<AlertData>) {
  const data = item.data;
  const styles = useMemo(
    () => ({
      card: {
        gap: layout.compact ? 6 : 8,
        padding: layout.compact ? 10 : 14,
        borderRadius: 10,
        borderLeftWidth: 3,
        borderLeftColor:
          data.severity === "critical" ? theme.colors.statusDanger : theme.colors.statusWarning,
        backgroundColor: theme.colors.surface1,
      },
      title: {
        color:
          data.severity === "critical" ? theme.colors.statusDanger : theme.colors.statusWarning,
        fontSize: layout.compact ? 14 : 15,
        fontWeight: "600" as const,
      },
      detail: {
        color: theme.colors.foreground,
        fontSize: layout.compact ? 12 : 13,
      },
      footer: {
        color: theme.colors.foregroundMuted,
        fontSize: layout.compact ? 11 : 12,
      },
    }),
    [theme, layout.compact, data.severity],
  );

  if (data.cleared) {
    return null;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{data.title}</Text>
      {data.details.map((line, index) => (
        <Text key={index} style={styles.detail}>
          {line}
        </Text>
      ))}
      <Text
        style={styles.footer}
      >{`Verificado em ${new Date(data.checkedAt).toLocaleString("pt-BR")}`}</Text>
    </View>
  );
}
