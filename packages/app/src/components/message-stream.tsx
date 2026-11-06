import { useStableEvent } from "@/hooks/use-stable-event";
import { getAgentAttachmentPillContent } from "@/attachments/attachment-pill-content";
import { AssistantForkMenu, type AssistantForkTarget } from "@/components/assistant-fork-menu";
import { AttachmentLightbox, type ImageLightboxSource } from "@/components/attachment-lightbox";
import {
  AttachmentFrame,
  AttachmentLabel,
  AttachmentThumbnail,
} from "@/components/attachment-pill";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { RewindMenu, type RewindMode } from "@/components/rewind/rewind-menu";
import { useRewindAgentMutation } from "@/components/rewind/use-rewind-agent-mutation";
import { TaskListRow } from "@/components/task-list-row";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { useRevealedText, type MarkdownPhase } from "@/hooks/use-revealed-text";
import { ICON_SIZE } from "@/styles/theme";
import type { TaskActivity, TodoEntry, UserMessageImageAttachment } from "@/types/stream";
import { setAssistantMessageHeight } from "@/utils/assistant-message-height-estimate";
import { isRenderProfileEnabled } from "@/utils/render-profiler";
import { writeMarkdownToRichClipboard } from "@/utils/rich-clipboard";
import { getDefaultMarkdownClipboardEnvironment } from "@/utils/rich-clipboard-default-environment";
import { formatDuration, formatMessageTimestamp } from "@/utils/time";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentCapabilityFlags } from "@getpaseo/protocol/agent-types";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import {
  expandInlineChips,
  hasInlineChip,
  mentionChipCoversAttachment,
} from "@getpaseo/protocol/inline-chip";
import { InlineMessageText } from "@/composer/inline-context-chip";
import { Check, CheckSquare, CircleDot, Copy, Plus, Scissors } from "lucide-react-native";
import * as React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleProp, Text, View, ViewStyle, type TextStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { capAssistantMessageForRender, getUtf8ByteLength } from "./assistant-message-render-limit";
import { getTurnDurationLabel } from "./assistant-turn-footer-label";
import { getCompactionMarkerLabel } from "./message-compaction-label";
import { getPortingMarkerLabel } from "./message-porting-label";
import { ExpandableBadge } from "@/components/message-expandable";
import {
  STREAM_METADATA_FONT_SIZE,
  ThemedMicVocal,
  destructiveColorMapping,
  infoColorMapping,
  useDisableOuterSpacing,
  warningColorMapping,
  ThemedNotificationError,
  ThemedNotificationInfo,
  ThemedNotificationWarning,
  foregroundMutedColorMapping,
} from "@/components/message-shared";

interface UserMessageProps {
  serverId?: string;
  agentId?: string;
  messageId?: string;
  message: string;
  images?: UserMessageImageAttachment[];
  attachments?: AgentAttachment[];
  timestamp: number;
  capabilities?: AgentCapabilityFlags;
  client?: DaemonClient | null;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  isPending?: boolean;
  disableOuterSpacing?: boolean;
  onFork?: (target: AssistantForkTarget) => Promise<void> | void;
}

const userMessageStylesheet = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    justifyContent: "flex-end",
    ...(isWeb ? { userSelect: "text" as const } : {}),
  },
  content: {
    alignItems: "flex-end",
    maxWidth: "100%",
    cursor: "auto",
  },
  containerSpacing: {
    marginBottom: theme.spacing[1],
  },
  containerFirstInGroup: {
    marginTop: theme.spacing[4],
  },
  containerLastInGroup: {
    marginBottom: theme.spacing[4],
  },
  bubble: {
    backgroundColor: theme.colors.surface3,
    borderRadius: theme.borderRadius["2xl"],
    borderTopRightRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
    minWidth: 0,
    flexShrink: 1,
  },
  text: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.content,
    ...(isWeb
      ? {
          lineHeight: Math.round(theme.fontSize.content * 1.4),
          overflowWrap: "anywhere" as const,
        }
      : {}),
  },
  imagePreviewContainer: {
    flexDirection: "row",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  attachmentPreviewContainer: {
    flexDirection: "row",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  imagePreviewSpacing: {
    marginBottom: theme.spacing[2],
  },
  copyButton: {
    alignSelf: "center",
    padding: theme.spacing[1],
    paddingTop: theme.spacing[1],
    marginTop: 0,
    marginRight: -theme.spacing[1],
  },
  trailingRow: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    height: 24,
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  trailingRowHidden: {
    opacity: 0,
  },
  trailingRowVisible: {
    opacity: 1,
  },
  timestampText: {
    color: theme.colors.foregroundMuted,
    fontSize: STREAM_METADATA_FONT_SIZE,
  },
}));

interface UserMessageImagePillProps {
  image: UserMessageImageAttachment;
  onOpen: (image: UserMessageImageAttachment) => void;
  accessibilityLabel: string;
}

function UserMessageImagePill({ image, onOpen, accessibilityLabel }: UserMessageImagePillProps) {
  const handlePress = useCallback(() => {
    onOpen(image);
  }, [onOpen, image]);
  return (
    <AttachmentFrame onPress={handlePress} accessibilityLabel={accessibilityLabel}>
      <AttachmentThumbnail metadata={image} />
    </AttachmentFrame>
  );
}

const MESSAGE_TEXT_DATASET = { messageText: "true" };

interface UserMessageTrailingRowProps {
  formattedTimestamp: string;
  capabilities?: AgentCapabilityFlags;
  messageId?: string;
  message: string;
  rewindPending: boolean;
  onRewind: (input: { mode: RewindMode; rewoundText: string }) => void | Promise<void>;
  canForkUserMessage: boolean;
  onFork?: (target: AssistantForkTarget) => void;
  getMessageContent: () => string;
}

const UserMessageTrailingRow = memo(function UserMessageTrailingRow({
  formattedTimestamp,
  capabilities,
  messageId,
  message,
  rewindPending,
  onRewind,
  canForkUserMessage,
  onFork,
  getMessageContent,
}: UserMessageTrailingRowProps) {
  const { t } = useTranslation();
  return (
    <View style={userMessageStylesheet.trailingRow} testID="user-message-trailing-row">
      <Text style={userMessageStylesheet.timestampText} testID="user-message-timestamp">
        {formattedTimestamp}
      </Text>
      {capabilities && messageId ? (
        <RewindMenu
          capabilities={capabilities}
          isPending={rewindPending}
          rewoundText={message}
          onRewind={onRewind}
        />
      ) : null}
      {canForkUserMessage && onFork ? (
        <AssistantForkMenu
          onFork={onFork}
          testID="user-message-fork-menu"
          accessibilityLabel={t("message.actions.forkUserMessageMenu")}
        />
      ) : null}
      <TurnCopyButton
        getContent={getMessageContent}
        containerStyle={userMessageStylesheet.copyButton}
        accessibilityLabel={t("message.actions.copyMessage")}
      />
    </View>
  );
});

export const UserMessage = memo(function UserMessage({
  serverId,
  agentId,
  messageId,
  message,
  images = [],
  attachments = [],
  timestamp,
  capabilities,
  client,
  isFirstInGroup = true,
  isLastInGroup = true,
  isPending = false,
  disableOuterSpacing,
  onFork,
}: UserMessageProps) {
  const isCompact = useIsCompactFormFactor();
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const [lightboxMetadata, setLightboxMetadata] = useState<UserMessageImageAttachment | null>(null);
  const handleLightboxClose = useCallback(() => setLightboxMetadata(null), []);
  const lightboxSource = useMemo<ImageLightboxSource | null>(
    () => (lightboxMetadata ? { type: "attachment", metadata: lightboxMetadata } : null),
    [lightboxMetadata],
  );
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  const hasText = message.trim().length > 0;
  const hasImages = images.length > 0;
  const visibleAttachments = useMemo(
    () =>
      attachments.filter((attachment) => {
        if (attachment.type !== "text" || attachment.contextKind !== "chat_history") return true;
        return !mentionChipCoversAttachment(message, attachment.text);
      }),
    [attachments, message],
  );
  const hasAttachments = visibleAttachments.length > 0;
  const messageHasChip = hasInlineChip(message);
  const canForkUserMessage = Boolean(onFork);
  const showTrailingRow =
    !isPending && hasText && (isCompact || isNative || isHovered || canForkUserMessage);
  const formattedTimestamp = useMemo(
    () => formatMessageTimestamp(new Date(timestamp)),
    [timestamp],
  );
  const rewindMutation = useRewindAgentMutation({ serverId, agentId, client, messageId });

  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const getMessageContent = useCallback(() => expandInlineChips(message, "copy"), [message]);
  const handleRewind = useCallback(
    (input: { mode: RewindMode; rewoundText: string }) => {
      return rewindMutation.rewindAgent(input);
    },
    [rewindMutation],
  );

  const containerStyle = useMemo(
    () => [
      userMessageStylesheet.container,
      !resolvedDisableOuterSpacing && [
        isFirstInGroup ? userMessageStylesheet.containerFirstInGroup : null,
        isLastInGroup ? userMessageStylesheet.containerLastInGroup : null,
        !isFirstInGroup || !isLastInGroup ? userMessageStylesheet.containerSpacing : null,
      ],
    ],
    [resolvedDisableOuterSpacing, isFirstInGroup, isLastInGroup],
  );
  const imagePreviewContainerStyle = useMemo(
    () => [
      userMessageStylesheet.imagePreviewContainer,
      hasText || hasAttachments ? userMessageStylesheet.imagePreviewSpacing : undefined,
    ],
    [hasAttachments, hasText],
  );
  const attachmentPreviewContainerStyle = useMemo(
    () => [
      userMessageStylesheet.attachmentPreviewContainer,
      hasText ? userMessageStylesheet.imagePreviewSpacing : undefined,
    ],
    [hasText],
  );
  const trailingRowStyle = useMemo(
    () => [
      userMessageStylesheet.trailingRow,
      showTrailingRow
        ? userMessageStylesheet.trailingRowVisible
        : userMessageStylesheet.trailingRowHidden,
    ],
    [showTrailingRow],
  );

  let messageText: React.ReactNode = null;
  if (hasText && messageHasChip) {
    messageText = (
      <InlineMessageText
        text={message}
        style={userMessageStylesheet.text}
        dataSet={MESSAGE_TEXT_DATASET}
      />
    );
  } else if (hasText) {
    messageText = (
      <Text selectable style={userMessageStylesheet.text} dataSet={MESSAGE_TEXT_DATASET}>
        {message}
      </Text>
    );
  }

  return (
    <View style={containerStyle} testID="user-message" aria-busy={isPending}>
      <View
        style={userMessageStylesheet.content}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <View style={userMessageStylesheet.bubble}>
          {hasImages ? (
            <View style={imagePreviewContainerStyle}>
              {images.map((image) => (
                <UserMessageImagePill
                  key={image.id}
                  image={image}
                  onOpen={setLightboxMetadata}
                  accessibilityLabel={t("composer.attachments.openImage")}
                />
              ))}
            </View>
          ) : null}
          {hasAttachments ? (
            <View style={attachmentPreviewContainerStyle}>
              {visibleAttachments.map((attachment, index) => {
                const content = getAgentAttachmentPillContent(attachment, t);
                return (
                  <AttachmentFrame
                    key={`${attachment.type}:${"number" in attachment ? attachment.number : index}`}
                  >
                    <AttachmentLabel
                      icon={content.icon}
                      title={content.title}
                      subtitle={content.subtitle}
                    />
                  </AttachmentFrame>
                );
              })}
            </View>
          ) : null}
          {messageText}
        </View>
        {hasText ? (
          <View style={trailingRowStyle} pointerEvents={showTrailingRow ? "auto" : "none"}>
            <UserMessageTrailingRow
              formattedTimestamp={formattedTimestamp}
              capabilities={capabilities}
              messageId={messageId}
              message={message}
              rewindPending={rewindMutation.isPending}
              onRewind={handleRewind}
              canForkUserMessage={canForkUserMessage}
              onFork={onFork}
              getMessageContent={getMessageContent}
            />
          </View>
        ) : null}
      </View>
      <AttachmentLightbox source={lightboxSource} onClose={handleLightboxClose} />
    </View>
  );
});

interface AssistantTurnFooterProps {
  getContent: () => string;
  completedAt?: Date;
  durationMs?: number | null;
  onFork?: (target: AssistantForkTarget) => Promise<void> | void;
}

const assistantTurnFooterStylesheet = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  copyButton: {
    alignSelf: "center",
    padding: theme.spacing[1],
    paddingTop: theme.spacing[1],
    marginTop: 0,
    marginLeft: -theme.spacing[1],
  },
  labelWrapper: {
    position: "relative",
  },
  labelSizer: {
    color: theme.colors.foregroundMuted,
    fontSize: STREAM_METADATA_FONT_SIZE,
    opacity: 0,
  },
  labelOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    color: theme.colors.foregroundMuted,
    fontSize: STREAM_METADATA_FONT_SIZE,
  },
}));

const TIMESTAMP_REVEAL_MS = 3000;

/**
 * Footer rendered next to the copy button at the end of an assistant turn.
 * Shows the turn duration and swaps to the end timestamp when both are known.
 * A turn without a visible start shows its end timestamp directly.
 */
export const AssistantTurnFooter = memo(function AssistantTurnFooter({
  getContent,
  completedAt,
  durationMs,
  onFork,
}: AssistantTurnFooterProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [pressedReveal, setPressedReveal] = useState(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (revealTimerRef.current) {
        clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }
    };
  }, []);

  const durationLabel = useMemo(
    () =>
      durationMs !== undefined && durationMs !== null ? getTurnDurationLabel(durationMs, t) : "",
    [durationMs, t],
  );
  const timestampLabel = useMemo(
    () => (completedAt ? formatMessageTimestamp(completedAt) : ""),
    [completedAt],
  );

  const primaryLabel = durationLabel || timestampLabel;
  const canSwap = Boolean(durationLabel && timestampLabel);
  const showTimestamp = canSwap && (isWeb ? hovered : pressedReveal);

  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);
  const handlePress = useCallback(() => {
    if (isWeb || !canSwap) return;
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
    }
    setPressedReveal((prev) => !prev);
    revealTimerRef.current = setTimeout(() => {
      setPressedReveal(false);
      revealTimerRef.current = null;
    }, TIMESTAMP_REVEAL_MS);
  }, [canSwap]);
  const handleFork = useCallback(
    (target: AssistantForkTarget) => {
      return onFork?.(target);
    },
    [onFork],
  );
  const canFork = Boolean(onFork);

  return (
    <View style={assistantTurnFooterStylesheet.container}>
      <TurnCopyButton
        getContent={getContent}
        containerStyle={assistantTurnFooterStylesheet.copyButton}
      />
      {canFork ? <AssistantForkMenu onFork={handleFork} /> : null}
      {primaryLabel ? (
        <Pressable
          onPress={handlePress}
          onHoverIn={handleHoverIn}
          onHoverOut={handleHoverOut}
          accessibilityRole={canSwap ? "button" : undefined}
          accessibilityLabel={canSwap ? `${durationLabel}, ended ${timestampLabel}` : primaryLabel}
        >
          <View style={assistantTurnFooterStylesheet.labelWrapper}>
            {/* Sizer reserves space for whichever label is longer so the
                container width is stable across hover transitions. */}
            <Text style={assistantTurnFooterStylesheet.labelSizer} aria-hidden>
              {primaryLabel.length >= timestampLabel.length ? primaryLabel : timestampLabel}
            </Text>
            <Text style={assistantTurnFooterStylesheet.labelOverlay}>
              {showTimestamp ? timestampLabel : primaryLabel}
            </Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
});

interface LiveElapsedProps {
  startedAt: Date;
  active?: boolean;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * Ticks every second to render an elapsed duration. Isolated from parents so
 * only this component re-renders on each tick.
 */
export const LiveElapsed = memo(function LiveElapsed({
  startedAt,
  active = true,
  style,
  testID,
}: LiveElapsedProps) {
  const startedAtMs = startedAt.getTime();
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - startedAtMs));
  const visibleElapsedMs = active ? Math.max(0, Date.now() - startedAtMs) : elapsedMs;

  useEffect(() => {
    if (!active) {
      return;
    }
    setElapsedMs(Math.max(0, Date.now() - startedAtMs));
    const handle = setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startedAtMs));
    }, 1000);
    return () => clearInterval(handle);
  }, [active, startedAtMs]);

  return (
    <Text style={style} testID={testID}>
      {formatDuration(visibleElapsedMs)}
    </Text>
  );
});

interface AssistantMessageProps {
  renderFullContent?: boolean;
  occurrenceKey: string;
  message: string;
  timestamp: number;
  workspaceRoot?: string;
  serverId?: string;
  client?: DaemonClient | null;
  spacing?: "default" | "compactTop" | "compactBottom" | "compactBoth";
  phase: MarkdownPhase;
}

export const assistantMessageStylesheet = StyleSheet.create((theme) => ({
  container: {
    paddingVertical: theme.spacing[3],
    ...(isWeb ? { userSelect: "text" as const } : {}),
  },
  containerCompactTop: {
    paddingTop: 0,
  },
  containerCompactBottom: {
    paddingBottom: 0,
  },
  cappedNotice: {
    marginTop: theme.spacing[3],
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.base,
    fontStyle: "italic",
    color: theme.colors.foregroundMuted,
  },
  imageFrame: {
    width: "100%",
    minHeight: 160,
    marginHorizontal: -theme.spacing[1],
  },
  imageSurface: {
    width: "100%",
    overflow: "hidden",
    position: "relative",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  imageLoadingOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  imageState: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[6],
    gap: theme.spacing[2],
  },
  imageErrorText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
}));

const turnCopyButtonStylesheet = StyleSheet.create((theme) => ({
  container: {
    alignSelf: "flex-start",
    padding: theme.spacing[2],
    paddingTop: 0,
    marginTop: theme.spacing[2],
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
  iconHoveredColor: {
    color: theme.colors.foreground,
  },
}));

interface TurnCopyButtonProps {
  getContent: () => string;
  containerStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  copiedAccessibilityLabel?: string;
}

export const TurnCopyButton = memo(function TurnCopyButton({
  getContent,
  containerStyle,
  accessibilityLabel,
  copiedAccessibilityLabel,
}: TurnCopyButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(async () => {
    const content = getContent();
    if (!content) {
      return;
    }

    await writeMarkdownToRichClipboard(content, getDefaultMarkdownClipboardEnvironment());
    setCopied(true);

    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }

    copyTimeoutRef.current = setTimeout(() => {
      setCopied(false);
      copyTimeoutRef.current = null;
    }, 1500);
  }, [getContent]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const pressableStyle = useMemo(
    () => [turnCopyButtonStylesheet.container, containerStyle],
    [containerStyle],
  );

  return (
    <Pressable
      onPress={handleCopy}
      style={pressableStyle}
      accessibilityRole="button"
      accessibilityLabel={
        copied
          ? (copiedAccessibilityLabel ?? t("message.actions.copied"))
          : (accessibilityLabel ?? t("message.actions.copyTurn"))
      }
    >
      {({ hovered }) => {
        const iconColor = hovered
          ? turnCopyButtonStylesheet.iconHoveredColor.color
          : turnCopyButtonStylesheet.iconColor.color;
        return copied ? (
          <Check size={ICON_SIZE.sm} color={iconColor} />
        ) : (
          <Copy size={ICON_SIZE.sm} color={iconColor} />
        );
      }}
    </Pressable>
  );
});
export const AssistantMessage = memo(function AssistantMessage({
  renderFullContent = false,
  occurrenceKey,
  message,
  timestamp: _timestamp,
  workspaceRoot,
  serverId,
  client,
  spacing = "default",
  phase,
}: AssistantMessageProps) {
  const { t } = useTranslation();
  const renderedMessage = useMemo(
    () =>
      renderFullContent ? { text: message, capped: false } : capAssistantMessageForRender(message),
    [message, renderFullContent],
  );
  const revealedText = useRevealedText(renderedMessage.text, phase);
  const revealedMessage = renderFullContent ? renderedMessage.text : revealedText;
  const fullMessageByteLength = useMemo(
    () => (renderedMessage.capped && phase === "complete" ? getUtf8ByteLength(message) : null),
    [message, phase, renderedMessage.capped],
  );

  const assistantContainerStyle = useMemo(
    () => [
      assistantMessageStylesheet.container,
      (spacing === "compactTop" || spacing === "compactBoth") &&
        assistantMessageStylesheet.containerCompactTop,
      (spacing === "compactBottom" || spacing === "compactBoth") &&
        assistantMessageStylesheet.containerCompactBottom,
    ],
    [spacing],
  );
  const revealDataSet = useMemo(
    () =>
      isRenderProfileEnabled()
        ? {
            ...MESSAGE_TEXT_DATASET,
            revealKey: occurrenceKey,
            revealLength: String(revealedMessage.length),
          }
        : MESSAGE_TEXT_DATASET,
    [occurrenceKey, revealedMessage.length],
  );

  const measureMessage = useStableEvent((event: import("react-native").LayoutChangeEvent) => {
    setAssistantMessageHeight({ markdown: revealedMessage, ...event.nativeEvent.layout });
  });
  return (
    <View
      testID="assistant-message"
      dataSet={revealDataSet}
      style={assistantContainerStyle}
      onLayout={measureMessage}
    >
      <MarkdownRenderer
        text={revealedMessage}
        streaming={phase !== "complete" || revealedMessage.length < renderedMessage.text.length}
        client={client}
        workspaceRoot={workspaceRoot}
        serverId={serverId}
      />
      {fullMessageByteLength !== null ? (
        <Text
          testID="assistant-message-capped-notice"
          style={assistantMessageStylesheet.cappedNotice}
        >
          {t("agentStream.messageCapped", { bytes: fullMessageByteLength })}
        </Text>
      ) : null}
    </View>
  );
});

interface SpeakMessageProps {
  message: string;
  timestamp: number;
  disableOuterSpacing?: boolean;
}

const speakMessageStylesheet = StyleSheet.create((theme) => ({
  container: {
    paddingVertical: theme.spacing[3],
  },
  containerSpacing: {
    marginBottom: theme.spacing[4],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
  },
  headerLabel: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  text: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.content,
    lineHeight: Math.round(theme.fontSize.content * 1.4),
    color: theme.colors.foreground,
  },
}));

export const SpeakMessage = memo(function SpeakMessage({
  message,
  timestamp: _timestamp,
  disableOuterSpacing,
}: SpeakMessageProps) {
  const { t } = useTranslation();
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  const containerStyle = useMemo(
    () => [
      speakMessageStylesheet.container,
      !resolvedDisableOuterSpacing && speakMessageStylesheet.containerSpacing,
    ],
    [resolvedDisableOuterSpacing],
  );

  return (
    <View testID="speak-message" style={containerStyle}>
      <View style={speakMessageStylesheet.header}>
        <ThemedMicVocal size={12} uniProps={foregroundMutedColorMapping} />
        <Text style={speakMessageStylesheet.headerLabel}>{t("message.speak.header")}</Text>
      </View>
      <Text style={speakMessageStylesheet.text}>{message}</Text>
    </View>
  );
});

interface NotificationProps {
  level: "info" | "warning" | "error";
  message: string;
  disableOuterSpacing?: boolean;
}

const notificationStylesheet = StyleSheet.create((theme) => ({
  container: {
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
  },
  containerSpacing: {
    marginBottom: theme.spacing[1],
  },
  infoBg: {
    backgroundColor: "rgba(147, 197, 253, 0.1)",
  },
  warningBg: {
    backgroundColor: "rgba(245, 158, 11, 0.1)",
  },
  errorBg: {
    backgroundColor: "rgba(239, 68, 68, 0.1)",
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  iconContainer: {
    flexShrink: 0,
    height: 20,
    justifyContent: "center",
  },
  textContainer: {
    flex: 1,
  },
  messageText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: 20,
  },
}));

export const Notification = memo(function Notification({
  level,
  message,
  disableOuterSpacing,
}: NotificationProps) {
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);

  const typeConfig = {
    info: {
      bg: notificationStylesheet.infoBg,
      iconColorMapping: infoColorMapping,
      Icon: ThemedNotificationInfo,
    },
    warning: {
      bg: notificationStylesheet.warningBg,
      iconColorMapping: warningColorMapping,
      Icon: ThemedNotificationWarning,
    },
    error: {
      bg: notificationStylesheet.errorBg,
      iconColorMapping: destructiveColorMapping,
      Icon: ThemedNotificationError,
    },
  };

  const config = typeConfig[level];
  const IconComponent = config.Icon;

  const containerStyle = useMemo(
    () => [
      notificationStylesheet.container,
      !resolvedDisableOuterSpacing && notificationStylesheet.containerSpacing,
      config.bg,
    ],
    [resolvedDisableOuterSpacing, config.bg],
  );
  return (
    <View style={containerStyle}>
      <View style={notificationStylesheet.content}>
        <View style={notificationStylesheet.row}>
          <View style={notificationStylesheet.iconContainer}>
            <IconComponent size={16} uniProps={config.iconColorMapping} />
          </View>
          <View style={notificationStylesheet.textContainer}>
            <Text style={notificationStylesheet.messageText} selectable>
              {message}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
});

interface CompactionMarkerProps {
  status: "loading" | "completed";
  trigger?: "auto" | "manual";
  preTokens?: number;
}

const compactionStylesheet = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.border,
  },
  label: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  text: {
    fontFamily: theme.fontFamily.ui,
    fontSize: 13,
    color: theme.colors.foregroundMuted,
  },
}));

export const CompactionMarker = memo(function CompactionMarker({
  status,
  trigger,
  preTokens,
}: CompactionMarkerProps) {
  const label = getCompactionMarkerLabel({ status, trigger, preTokens });

  return (
    <View style={compactionStylesheet.container}>
      <View style={compactionStylesheet.line} />
      <View style={compactionStylesheet.label}>
        {status === "loading" ? (
          <LoadingSpinner size="small" color="#a1a1aa" />
        ) : (
          <Scissors size={12} color="#a1a1aa" />
        )}
        <Text style={compactionStylesheet.text}>{label}</Text>
      </View>
      <View style={compactionStylesheet.line} />
    </View>
  );
});

export const PortingMarker = memo(function PortingMarker({
  status,
  provider,
}: {
  status: "loading" | "completed";
  provider?: string;
}) {
  const label = getPortingMarkerLabel({ status, provider });

  return (
    <View style={compactionStylesheet.container}>
      <View style={compactionStylesheet.line} />
      <View style={compactionStylesheet.label}>
        {status === "loading" ? (
          <LoadingSpinner size="small" color="#a1a1aa" />
        ) : (
          <Scissors size={12} color="#a1a1aa" />
        )}
        <Text style={compactionStylesheet.text}>{label}</Text>
      </View>
      <View style={compactionStylesheet.line} />
    </View>
  );
});

interface TodoListCardProps {
  items: TodoEntry[];
  activity: TaskActivity;
  disableOuterSpacing?: boolean;
}

function taskActivityIcon(activity: TaskActivity) {
  switch (activity.type) {
    case "added":
      return Plus;
    case "started":
      return CircleDot;
    case "completed":
      return Check;
    default:
      return CheckSquare;
  }
}

const todoListCardStylesheet = StyleSheet.create((theme) => ({
  detailsWrapper: {
    padding: theme.spacing[2],
  },
  list: {
    gap: theme.spacing[1],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));

export const TodoListCard = memo(function TodoListCard({
  items,
  activity,
  disableOuterSpacing,
}: TodoListCardProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const activityDisplay = useMemo(() => {
    if (activity.type === "created") {
      return {
        label: t("message.todo.activity.created", { count: activity.count }),
        secondaryLabel: undefined,
      };
    }
    return {
      label: t(`message.todo.activity.${activity.type}`),
      secondaryLabel: activity.task,
    };
  }, [activity, t]);

  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const renderDetails = useCallback(() => {
    return (
      <View style={todoListCardStylesheet.detailsWrapper}>
        <View style={todoListCardStylesheet.list}>
          {items.length === 0 ? (
            <Text style={todoListCardStylesheet.emptyText}>{t("message.todo.empty")}</Text>
          ) : (
            items.map((item) => <TaskListRow key={item.id ?? item.text} task={item} />)
          )}
        </View>
      </View>
    );
  }, [items, t]);

  return (
    <ExpandableBadge
      label={activityDisplay.label}
      secondaryLabel={activityDisplay.secondaryLabel}
      icon={taskActivityIcon(activity)}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      renderDetails={renderDetails}
      disableOuterSpacing={disableOuterSpacing}
    />
  );
});
