import { useCallback, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { PressHighlight } from "@/components/ui/press-highlight";
import { SearchField } from "@/components/ui/search-field";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import {
  MCP_SERVER_PRESETS,
  PRESET_CATEGORIES,
  type McpServerPreset,
  type PresetCategory,
} from "../internal/mcp-server-presets";

interface McpPresetPickerProps {
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (preset: McpServerPreset) => void;
}

export function McpPresetPicker({
  query,
  onQueryChange,
  onSelect,
}: McpPresetPickerProps): ReactElement {
  const { t } = useTranslation();
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return MCP_SERVER_PRESETS;
    return MCP_SERVER_PRESETS.filter(
      (preset) =>
        preset.label.toLowerCase().includes(term) ||
        preset.description.toLowerCase().includes(term) ||
        preset.category.includes(term),
    );
  }, [query]);
  const grouped = useMemo(() => {
    const groups = new Map<PresetCategory, McpServerPreset[]>();
    for (const category of PRESET_CATEGORIES) {
      const presets = filtered.filter((preset) => preset.category === category);
      if (presets.length > 0) groups.set(category, presets);
    }
    return groups;
  }, [filtered]);

  return (
    <View style={styles.container}>
      <SearchField
        value={query}
        onChangeText={onQueryChange}
        placeholder={t("settings.host.mcp.presets.search")}
        clearAccessibilityLabel={t("settings.host.mcp.presets.clearSearch")}
      />
      {grouped.size === 0 ? (
        <Text style={styles.empty}>{t("settings.host.mcp.presets.empty")}</Text>
      ) : (
        [...grouped.entries()].map(([category, presets]) => (
          <View key={category} style={styles.group}>
            <Text style={styles.groupTitle}>
              {t(`settings.host.mcp.presets.categories.${category}`)}
            </Text>
            <View style={settingsStyles.card}>
              {presets.map((preset, index) => (
                <PresetRow
                  key={preset.id}
                  preset={preset}
                  isFirst={index === 0}
                  onSelect={onSelect}
                />
              ))}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function PresetRow({
  preset,
  isFirst,
  onSelect,
}: {
  preset: McpServerPreset;
  isFirst: boolean;
  onSelect: (preset: McpServerPreset) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onSelect(preset), [onSelect, preset]);
  const auth = useMemo(() => {
    const modes = new Set(preset.variants.map((variant) => variant.auth));
    if (modes.has("oauth")) return "OAuth";
    if (modes.has("token")) return "Token";
    return null;
  }, [preset]);
  return (
    <PressHighlight
      onPress={handleSelect}
      highlightStyle={styles.rowHighlight}
      style={[settingsStyles.row, !isFirst && settingsStyles.rowBorder]}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{preset.label}</Text>
        <Text style={settingsStyles.rowHint} numberOfLines={2}>
          {preset.description}
        </Text>
      </View>
      <View style={styles.badges}>
        {auth ? <Text style={styles.badge}>{auth}</Text> : null}
        <Text style={styles.count}>
          {t("settings.host.mcp.presets.variants", { count: preset.variants.length })}
        </Text>
      </View>
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
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
  badges: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  badge: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize["2xs"],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[1],
    paddingVertical: 1,
  },
  count: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize["2xs"],
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
