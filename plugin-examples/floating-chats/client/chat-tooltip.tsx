import type { PluginAgentSnapshot, PluginWorkspaceSnapshot } from "@getpaseo/plugin";
import { StyleSheet, Text, View } from "react-native";
import { useMemo } from "react";

import type { NativeSkin } from "./native-skin";

/**
 * Conteúdo do tooltip exibido no popover nativo.
 *
 * @param props Snapshots do agente e do workspace, host e pele.
 * @returns O cartão de informações do chat.
 */
export function ChatTooltip({
  agent,
  workspace,
  hostLabel,
  skin,
}: {
  agent: PluginAgentSnapshot;
  workspace: PluginWorkspaceSnapshot | null;
  hostLabel: string;
  skin: NativeSkin;
}) {
  const title = agent.title ?? workspace?.title ?? workspace?.name ?? agent.id;
  const branch = workspace?.branch ?? null;
  const repo = workspace?.projectDisplayName ?? "sem repo";
  const local = workspace?.directory || agent.cwd || "sem local";
  const entries = useMemo(
    () => Object.entries(agent.labels ?? {}).filter(([name]) => name.trim().length > 0),
    [agent.labels],
  );
  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          padding: 12,
          gap: 6,
          backgroundColor: skin.surfaceColor,
          borderRadius: skin.cardRadius,
          borderWidth: 1,
          borderColor: skin.borderColor,
        },
        title: {
          color: skin.textColor,
          fontSize: skin.fontSize + 2,
          fontFamily: skin.fontFamily,
          fontWeight: "600",
        },
        row: { flexDirection: "row", gap: 6, alignItems: "center" },
        label: { color: skin.mutedColor, fontSize: skin.fontSize, fontFamily: skin.fontFamily },
        value: { color: skin.textColor, fontSize: skin.fontSize, fontFamily: skin.fontFamily },
        tags: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
        tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
        tagText: { fontSize: skin.fontSize - 1, fontFamily: skin.fontFamily },
      }),
    [skin],
  );

  return (
    <View style={styles.card}>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      <View style={styles.row}>
        <Text style={styles.label}>Branch</Text>
        <Text style={styles.value} numberOfLines={1}>
          {branch ?? "sem branch"}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Repo</Text>
        <Text style={styles.value} numberOfLines={1}>
          {repo}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Local</Text>
        <Text style={styles.value} numberOfLines={1}>
          {local}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Host</Text>
        <Text style={styles.value} numberOfLines={1}>
          {hostLabel}
        </Text>
      </View>
      <View style={styles.tags}>
        {entries.length === 0 ? (
          <Text style={styles.label}>sem tags</Text>
        ) : (
          entries.map(([name, color]) => {
            const hex = /^#[0-9a-fA-F]{6}$/.test(color) ? color : skin.accentColor;
            return (
              <View key={name} style={[styles.tag, { backgroundColor: `${hex}38` }]}>
                <Text style={[styles.tagText, { color: hex }]}>{name}</Text>
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}
