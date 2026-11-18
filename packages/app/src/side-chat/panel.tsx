import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostFeature } from "@/runtime/host-features";
import { useDraftStore } from "@/stores/draft-store";
import type { SideChatItem } from "@getpaseo/protocol/messages";
import { sideChatDraftKey } from "./draft-key";
import { useSideChatStore } from "./store";

const EMPTY_TRANSCRIPT: SideChatItem[] = [];

export function SideChatPanel({ serverId, agentId }: { serverId: string; agentId: string }) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const sideChatEnabled = useHostFeature(serverId, "agentSideQuestion");
  const inputRef = useRef<EditingTextInputHandle>(null);
  const draftKey = sideChatDraftKey(serverId, agentId);
  const open = useSideChatStore((state) => state.openAgentIds[agentId] === true);
  const focusRequest = useSideChatStore((state) => state.focusRequest[agentId] ?? 0);
  const transcript = useSideChatStore((state) => state.transcript[agentId]) ?? EMPTY_TRANSCRIPT;
  const liveText = useSideChatStore((state) => state.liveText[agentId] ?? "");
  const pending = useSideChatStore((state) => state.pending[agentId] === true);
  const error = useSideChatStore((state) => state.error[agentId] ?? null);
  const draft = useDraftStore((state) => state.drafts[draftKey]);
  const text = draft?.lifecycle === "active" ? draft.input.text : "";
  const quotes = (draft?.lifecycle === "active" ? draft.input.attachments : []).filter(
    (attachment) => attachment.kind === "quote",
  );
  const quoteText = quotes.map((quote) => quote.text).join("\n");

  useEffect(() => {
    if (!open) return;
    void useSideChatStore.getState().refresh(serverId, agentId);
  }, [agentId, open, serverId]);

  useEffect(() => {
    if (!open || focusRequest === 0) return;
    inputRef.current?.focus();
  }, [focusRequest, open]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input || input.getText() === text) return;
    input.replaceText(text);
  }, [text]);

  const clear = useCallback(() => {
    void useSideChatStore.getState().clear(serverId, agentId);
  }, [agentId, serverId]);
  const close = useCallback(() => {
    useSideChatStore.getState().close(agentId);
  }, [agentId]);
  const editText = useCallback(
    (next: string) => {
      useDraftStore.getState().editDraftText({ draftKey, text: next });
    },
    [draftKey],
  );
  const send = useCallback(() => {
    void useSideChatStore.getState().submitDraft(serverId, agentId);
  }, [agentId, serverId]);

  if (!open) return null;

  return (
    <View style={compact ? styles.sheet : styles.column} testID="side-chat-panel">
      <View style={styles.header}>
        <Text style={styles.title}>{t("sideChat.title")}</Text>
        <Button variant="ghost" size="sm" onPress={clear} accessibilityLabel={t("sideChat.clear")}>
          {t("sideChat.clear")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={close}
          accessibilityLabel={t("common.actions.close")}
        >
          {t("common.actions.close")}
        </Button>
      </View>
      <ScrollView style={styles.transcript} contentContainerStyle={styles.transcriptContent}>
        {!sideChatEnabled ? <Text style={styles.empty}>{t("sideChat.updateHost")}</Text> : null}
        {sideChatEnabled && transcript.length === 0 && !liveText ? (
          <Text style={styles.empty}>{t("sideChat.empty")}</Text>
        ) : null}
        {transcript.map((item) => (
          <Text key={item.id} style={item.kind === "error" ? styles.error : styles.item}>
            {item.kind === "error" ? item.message : item.text}
          </Text>
        ))}
        {liveText ? <Text style={styles.item}>{liveText}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <View style={styles.composer}>
        {quoteText ? (
          <Text style={styles.quote} numberOfLines={3}>
            {quoteText}
          </Text>
        ) : null}
        <EditingTextInput
          ref={inputRef}
          initialValue={text}
          onChangeText={editText}
          placeholder={t("sideChat.placeholder")}
          style={styles.input}
          multiline
          testID="side-chat-input"
        />
        <Button
          variant="default"
          size="sm"
          disabled={pending || !sideChatEnabled}
          onPress={send}
          testID="side-chat-send"
        >
          {t("sideChat.send")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  column: {
    width: 360,
    flexShrink: 0,
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  sheet: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.colors.surface0,
    zIndex: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  title: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  transcript: { flex: 1 },
  transcriptContent: { padding: theme.spacing[3], gap: theme.spacing[3] },
  empty: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  item: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
  composer: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  quote: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  input: {
    minHeight: 72,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
