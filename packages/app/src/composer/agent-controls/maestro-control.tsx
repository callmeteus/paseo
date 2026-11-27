import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Sparkles } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import { toolbarContentSlot } from "@/components/ui/control-geometry";

const ThemedSparkles = withUnistyles(Sparkles);
const iconMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});

/**
 * Enters Maestro mode and chooses whether it works in one workspace or in all of
 * them. In Maestro mode the same control leaves the mode.
 */
export function MaestroModeControl({
  agentId,
  serverId,
  isMaestro,
  scope,
}: {
  agentId: string;
  serverId: string;
  isMaestro: boolean;
  scope: "workspace" | "all";
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { glyphs } = useComposerControlLayout();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);

  const select = useCallback(
    (mode: "maestro" | "agent", nextScope?: "workspace" | "all") => {
      if (!client || pending) return;
      setPending(true);
      void client
        .setAgentChatMode(agentId, mode, { timeout: 30_000, scope: nextScope })
        .catch((error: unknown) => {
          console.warn("[MaestroModeControl] Failed to switch mode", error);
          toast.error(t("composer.maestroControl.failed"));
        })
        .finally(() => setPending(false));
    },
    [agentId, client, pending, t, toast],
  );

  const selectWorkspace = useCallback(() => select("maestro", "workspace"), [select]);
  const selectAll = useCallback(() => select("maestro", "all"), [select]);
  const exitMaestro = useCallback(() => select("agent"), [select]);

  let label = t("composer.maestroControl.title");
  if (isMaestro) {
    label =
      scope === "all" ? t("composer.maestroControl.all") : t("composer.maestroControl.workspace");
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} compactMode="sheet">
      <DropdownMenuTrigger
        testID="composer-maestro-mode-control"
        disabled={!client || pending}
        accessibilityLabel={t("composer.maestroControl.label")}
        accessibilityRole="button"
        style={styles.button}
      >
        <View style={styles.row}>
          <ComposerToolbarGlyph role="label">
            <ThemedSparkles
              size={glyphs.label.size}
              strokeWidth={glyphs.label.strokeWidth}
              uniProps={iconMapping}
            />
          </ComposerToolbarGlyph>
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
        </View>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        offset={8}
        width={280}
        sheetTitle={t("composer.maestroControl.title")}
        testID="composer-maestro-mode-menu"
      >
        <DropdownMenuLabel>{t("composer.maestroControl.title")}</DropdownMenuLabel>
        <DropdownMenuItem
          testID="composer-maestro-mode-workspace"
          selected={isMaestro && scope === "workspace"}
          onSelect={selectWorkspace}
        >
          {t("composer.maestroControl.workspace")}
        </DropdownMenuItem>
        <DropdownMenuItem
          testID="composer-maestro-mode-all"
          selected={isMaestro && scope === "all"}
          onSelect={selectAll}
        >
          {t("composer.maestroControl.all")}
        </DropdownMenuItem>
        {isMaestro ? (
          <DropdownMenuItem testID="composer-maestro-mode-exit" onSelect={exitMaestro}>
            {t("composer.maestroControl.exit")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    ...toolbarContentSlot(),
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: "transparent",
    flexShrink: 0,
  },
  pressed: {
    backgroundColor: theme.colors.surface2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));
