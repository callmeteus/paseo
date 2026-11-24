import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useEffect, useMemo, useState } from "react";

import { getOverlayBridge } from "./bridge-access";
import type { OverlayConfig } from "./bridge";

const POSITIONS: Array<{ value: OverlayConfig["position"]; label: string }> = [
  { value: "top-left", label: "Superior esquerda" },
  { value: "top-right", label: "Superior direita" },
  { value: "bottom-left", label: "Inferior esquerda" },
  { value: "bottom-right", label: "Inferior direita" },
  { value: "top-center", label: "Superior centro" },
  { value: "bottom-center", label: "Inferior centro" },
];

/**
 * Tela de configuração do overlay.
 *
 * @param props Props padrão da screen do plugin.
 * @returns Controles de posição, margem, afastamento e animações.
 */
export function OverlaySettings({ theme }: PluginSurfaceProps) {
  const [config, setConfig] = useState<OverlayConfig | null>(null);

  useEffect(() => {
    void getOverlayBridge()
      ?.getConfig?.()
      .then((value) => {
        setConfig(value);
        return undefined;
      });
  }, []);

  const patch = (value: Partial<OverlayConfig>) => {
    setConfig((current) => (current ? { ...current, ...value } : current));
    void getOverlayBridge()?.setConfig?.(value);
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          flex: 1,
          padding: 20,
          gap: 24,
          backgroundColor: theme.colors.surface0,
        },
        title: {
          color: theme.colors.foreground,
          fontSize: 22,
          fontWeight: "600",
        },
        subtitle: {
          color: theme.colors.foregroundMuted,
          fontSize: 13,
          marginTop: -18,
        },
        card: {
          backgroundColor: theme.colors.surface1,
          borderRadius: 14,
          padding: 18,
          gap: 14,
        },
        sectionTitle: {
          color: theme.colors.foreground,
          fontSize: 15,
          fontWeight: "600",
        },
        hint: {
          color: theme.colors.foregroundMuted,
          fontSize: 12,
          marginTop: -8,
        },
        grid: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
        },
        option: {
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
        },
        optionActive: {
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.accent,
        },
        optionText: {
          color: theme.colors.foreground,
          fontSize: 13,
        },
        optionTextActive: {
          color: theme.colors.surface0,
          fontWeight: "600",
        },
        toggleRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        },
        toggleLabel: {
          color: theme.colors.foreground,
          fontSize: 14,
        },
        switchTrack: {
          width: 46,
          height: 28,
          borderRadius: 14,
          backgroundColor: theme.colors.accent,
          justifyContent: "center",
          paddingHorizontal: 3,
        },
        switchTrackOff: {
          backgroundColor: theme.colors.border,
        },
        switchThumb: {
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: theme.colors.surface0,
          alignSelf: "flex-start",
        },
        switchThumbOn: {
          alignSelf: "flex-end",
        },
        value: {
          color: theme.colors.accent,
          fontSize: 13,
          fontWeight: "600",
        },
        footer: {
          color: theme.colors.foregroundMuted,
          fontSize: 11,
          textAlign: "center",
        },
      }),
    [theme],
  );

  const animationsOn = config?.animations !== false;

  return (
    <ScrollView style={styles.root}>
      <Text style={styles.title}>Chats flutuantes</Text>
      <Text style={styles.subtitle}>Personalize a tira de conversas na área de trabalho.</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Posição</Text>
        <Text style={styles.hint}>Onde a tira fica na tela.</Text>
        <View style={styles.grid}>
          {POSITIONS.map(({ value, label }) => {
            const active = config?.position === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={() => patch({ position: value })}
                style={[styles.option, active ? styles.optionActive : null]}
              >
                <Text style={[styles.optionText, active ? styles.optionTextActive : null]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Comportamento</Text>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Animações</Text>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: animationsOn }}
            accessibilityLabel="Animações"
            onPress={() => patch({ animations: !animationsOn })}
            style={[styles.switchTrack, animationsOn ? null : styles.switchTrackOff]}
          >
            <View style={[styles.switchThumb, animationsOn ? styles.switchThumbOn : null]} />
          </Pressable>
        </View>
      </View>

      <Text style={styles.footer}>As mudanças são aplicadas na hora.</Text>
    </ScrollView>
  );
}
