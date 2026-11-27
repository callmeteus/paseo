import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MessageSquare, Bot } from "lucide-react-native";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useSessionStore } from "@/stores/session-store";

/**
 * Composer control that switches the current chat between OpenUI Chat mode and
 * Agent mode. The /mode command and the tab menu do the same thing; this puts
 * the switch where the user can see it.
 */
export function ChatModeToggle({
  agentId,
  serverId,
  isOpenUIChat,
}: {
  agentId: string;
  serverId: string;
  isOpenUIChat: boolean;
}) {
  const { t } = useTranslation();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const toggle = useCallback(() => {
    if (!client) return;
    const next = isOpenUIChat ? "agent" : "chat";
    void client.setAgentChatMode(agentId, next).catch(() => undefined);
  }, [agentId, client, isOpenUIChat]);

  const label = isOpenUIChat
    ? t("composer.chatModeToggle.chat")
    : t("composer.chatModeToggle.agent");
  const Icon = isOpenUIChat ? MessageSquare : Bot;

  return (
    <PressHighlight
      onPress={toggle}
      disabled={!client}
      accessibilityLabel={t("composer.chatModeToggle.label")}
      testID="composer-chat-mode-toggle"
      style={styles.button}
    >
      <View style={styles.row}>
        <Icon size={13} />
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexShrink: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  label: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
