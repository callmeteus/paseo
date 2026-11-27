import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MessageSquare, Bot } from "lucide-react-native";
import { PressHighlight } from "@/components/ui/press-highlight";
import { toolbarContentSlot } from "@/components/ui/control-geometry";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";

const ThemedMessageSquare = withUnistyles(MessageSquare);
const ThemedBot = withUnistyles(Bot);
const mutedMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});
const CHAT_MODE_SWITCH_TIMEOUT_MS = 30_000;

/**
 * Composer control that switches the current chat between OpenUI Chat mode and
 * Agent mode. The /mode command and the tab menu do the same thing; this puts
 * the switch where the user can see it.
 */
export function ChatModeToggle({
  agentId,
  serverId,
  isOpenUIChat,
  isMaestro = false,
  surface = "toolbar",
}: {
  agentId: string;
  serverId: string;
  isOpenUIChat: boolean;
  isMaestro?: boolean;
  surface?: "toolbar" | "sheet";
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { glyphs } = useComposerControlLayout();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [pending, setPending] = useState(false);
  const toggle = useCallback(() => {
    if (!client || pending) return;
    const next = isMaestro || isOpenUIChat ? "agent" : "chat";
    setPending(true);
    void client
      .setAgentChatMode(agentId, next, { timeout: CHAT_MODE_SWITCH_TIMEOUT_MS })
      .catch((error: unknown) => {
        console.warn("[ChatModeToggle] Failed to switch mode", error);
        toast.error(t("composer.chatModeToggle.failed"));
      })
      .finally(() => setPending(false));
  }, [agentId, client, isMaestro, isOpenUIChat, pending, t, toast]);

  let label = t("composer.chatModeToggle.agent");
  if (isOpenUIChat) label = t("composer.chatModeToggle.chat");
  if (isMaestro) label = t("composer.maestroControl.title");
  const Icon = isOpenUIChat ? ThemedMessageSquare : ThemedBot;
  const disabled = !client || pending;
  const isSheet = surface === "sheet";
  const accessibilityState = useMemo(() => ({ disabled, busy: pending }), [disabled, pending]);
  let glyph;
  if (pending) {
    glyph = <ActivityIndicator size="small" color={styles.label.color} />;
  } else if (isSheet) {
    glyph = <Icon size={16} strokeWidth={1.5} uniProps={mutedMapping} />;
  } else {
    glyph = (
      <ComposerToolbarGlyph role="label">
        <Icon
          size={glyphs.label.size}
          strokeWidth={glyphs.label.strokeWidth}
          uniProps={mutedMapping}
        />
      </ComposerToolbarGlyph>
    );
  }
  const buttonStyle = useCallback(
    ({ hovered = false, pressed = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      isSheet ? styles.sheetButton : styles.button,
      !isSheet && (hovered || pending) ? styles.hovered : null,
      (pressed || pending) && styles.pressed,
      disabled && styles.disabled,
    ],
    [disabled, isSheet, pending],
  );

  return (
    <PressHighlight
      onPress={toggle}
      disabled={disabled}
      accessibilityLabel={t("composer.chatModeToggle.label")}
      accessibilityState={accessibilityState}
      testID="composer-chat-mode-toggle"
      style={buttonStyle}
      highlightStyle={styles.pressed}
    >
      <View style={isSheet ? styles.sheetRow : styles.row}>
        {glyph}
        <Text style={isSheet ? styles.sheetLabel : styles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </PressHighlight>
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
  hovered: {
    backgroundColor: theme.colors.surface2,
  },
  pressed: {
    backgroundColor: theme.colors.surface2,
  },
  disabled: {
    opacity: 0.5,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  sheetButton: {
    minHeight: 44,
    marginHorizontal: -theme.spacing[1],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: theme.colors.surface1,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  sheetLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
}));
