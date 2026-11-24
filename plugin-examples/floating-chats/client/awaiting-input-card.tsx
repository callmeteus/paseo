import { StyleSheet, Text, View } from "react-native";
import { useMemo } from "react";

import type { NativeSkin } from "./native-skin";

/**
 * Balão persistente de pergunta ou pedido de permissão.
 *
 * @param props Título, descrição e pele.
 * @returns O balão com a ação de responder no Paseo.
 */
export function AwaitingInputCard({
  title,
  detail,
  skin,
}: {
  title: string;
  detail: string;
  skin: NativeSkin;
}) {
  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          width: 320,
          padding: 12,
          gap: 8,
          backgroundColor: skin.surfaceColor,
          borderRadius: skin.cardRadius,
          borderWidth: 1,
          borderColor: skin.accentColor,
        },
        title: {
          color: skin.textColor,
          fontSize: skin.fontSize + 1,
          fontFamily: skin.fontFamily,
          fontWeight: "600",
        },
        detail: { color: skin.mutedColor, fontSize: skin.fontSize, fontFamily: skin.fontFamily },
      }),
    [skin],
  );

  return (
    <View style={styles.card}>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      <Text style={styles.detail} numberOfLines={4}>
        {detail || "Responder no Paseo"}
      </Text>
    </View>
  );
}
