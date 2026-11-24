import { StyleSheet, Text, View } from "react-native";
import { useMemo } from "react";

import type { NativeSkin } from "./native-skin";

/**
 * Balão de prévia da última mensagem do agente.
 *
 * @param props Título, branch, repo e texto, além da pele.
 * @returns O balão com três linhas de prévia.
 */
export function MessagePreview({
  title,
  branch,
  repo,
  preview,
  skin,
}: {
  title: string;
  branch: string | null;
  repo: string;
  preview: string;
  skin: NativeSkin;
}) {
  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          width: 320,
          padding: 12,
          gap: 6,
          backgroundColor: skin.surfaceColor,
          borderRadius: skin.cardRadius,
          borderWidth: 1,
          borderColor: skin.borderColor,
        },
        header: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
        title: {
          flex: 1,
          color: skin.textColor,
          fontSize: skin.fontSize,
          fontFamily: skin.fontFamily,
          fontWeight: "600",
        },
        meta: { color: skin.mutedColor, fontSize: skin.fontSize - 1, fontFamily: skin.fontFamily },
        body: { color: skin.textColor, fontSize: skin.fontSize, fontFamily: skin.fontFamily },
        track: { height: 2, backgroundColor: skin.borderColor, borderRadius: 1 },
      }),
    [skin],
  );

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {branch ?? "sem branch"}
        </Text>
      </View>
      <Text style={styles.meta} numberOfLines={1}>
        {repo}
      </Text>
      <Text style={styles.body} numberOfLines={3}>
        {preview || "sem mensagem"}
      </Text>
      <View style={styles.track} />
    </View>
  );
}
