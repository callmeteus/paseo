import { useCallback, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Text, View, type StyleProp, type TextStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { parseInlineParts, type InlineChip } from "@getpaseo/protocol/inline-chip";
import type { Rect } from "@/components/ui/anchor";
import { AttachmentFrame, AttachmentThumbnail } from "@/components/attachment-pill";
import { isWeb } from "@/constants/platform";
import type { ComposerAttachment } from "@/attachments/types";
import { ComposerMirrorText } from "./composer-mirror-text";
import { InlineChipDisclosure } from "./inline-context-chip";
import { getUnistylesAppTheme, inlineChipChromeFromTheme } from "./inline-chip-chrome";

/**
 * The queue shows a queued message the way the composer does: the same skill,
 * list, and code styling, chips that disclose the full paste on hover, and the
 * attachments the message carries. The old row flattened everything to two
 * plain lines, so images disappeared and pastes lost their chrome.
 */
export function QueuedMessageContent({
  text,
  attachments,
  skillNames,
  onOpenAttachment,
  numberOfLines = 2,
  style,
}: {
  text: string;
  attachments: readonly ComposerAttachment[];
  skillNames: readonly string[];
  onOpenAttachment: (attachment: ComposerAttachment) => void;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}) {
  const { t } = useTranslation();
  const parts = useMemo(() => {
    let offset = 0;
    return parseInlineParts(text).map((part) => {
      const key = part.kind === "text" ? `text-${offset}` : `${part.chip.id}@${offset}`;
      offset += part.kind === "text" ? part.text.length : part.chip.id.length + 1;
      return { key, part };
    });
  }, [text]);
  const [open, setOpen] = useState<{ chip: InlineChip; anchor: Rect } | null>(null);
  const images = useMemo(
    () => attachments.filter((attachment) => attachment.kind === "image"),
    [attachments],
  );
  const others = attachments.length - images.length;
  const openImageLabel = t("composer.attachments.openImage");
  const handleOpen = useCallback((chip: InlineChip, anchor: Rect) => setOpen({ chip, anchor }), []);
  const handleClose = useCallback(() => setOpen(null), []);

  return (
    <View style={styles.container}>
      {attachments.length > 0 ? (
        <View style={styles.attachments}>
          {images.map((attachment) =>
            attachment.kind === "image" ? (
              <QueuedAttachmentButton
                key={attachment.metadata.id}
                attachment={attachment}
                label={attachment.metadata.fileName || openImageLabel}
                onOpen={onOpenAttachment}
              >
                <AttachmentThumbnail metadata={attachment.metadata} />
              </QueuedAttachmentButton>
            ) : null,
          )}
          {others > 0 ? <Text style={styles.attachmentCount}>+{others}</Text> : null}
        </View>
      ) : null}
      <Text style={style} numberOfLines={numberOfLines} ellipsizeMode="tail" selectable>
        {parts.map(({ key, part }) =>
          part.kind === "text" ? (
            <ComposerMirrorText
              key={key}
              text={part.text}
              skillNames={skillNames}
              style={style}
              skillStyle={styles.skill}
            />
          ) : (
            <QueuedChipSpan key={key} chip={part.chip} onOpen={handleOpen} />
          ),
        )}
      </Text>
      {open ? (
        <InlineChipDisclosure
          chip={open.chip}
          anchor={open.anchor}
          emptyBody={t("composer.inlineChip.mentionLoading")}
          onClose={handleClose}
        />
      ) : null}
    </View>
  );
}

function QueuedAttachmentButton({
  attachment,
  label,
  onOpen,
  children,
}: {
  attachment: ComposerAttachment;
  label: string;
  onOpen: (attachment: ComposerAttachment) => void;
  children: ReactNode;
}) {
  const handlePress = useCallback(() => {
    onOpen(attachment);
  }, [attachment, onOpen]);
  return (
    <View style={styles.thumbnail} {...(isWeb ? { onPointerDown: stopQueueDrag } : {})}>
      <AttachmentFrame onPress={handlePress} accessibilityLabel={label} testID="queued-attachment">
        {children}
      </AttachmentFrame>
    </View>
  );
}

function stopQueueDrag(event: { stopPropagation: () => void }): void {
  // The message text is the drag handle. A press on the thumbnail has to stay a click.
  event.stopPropagation();
}

function QueuedChipSpan({
  chip,
  onOpen,
}: {
  chip: InlineChip;
  onOpen: (chip: InlineChip, anchor: Rect) => void;
}) {
  const theme = getUnistylesAppTheme();
  const spanRef = useRef<ComponentRef<typeof Text>>(null);
  const chrome = inlineChipChromeFromTheme(theme);

  const openFromNode = useCallback(() => {
    const node = spanRef.current;
    if (!node) return;
    if (typeof node.measureInWindow === "function") {
      node.measureInWindow((x, y, width, height) => {
        onOpen(chip, { x, y, width, height });
      });
      return;
    }
    onOpen(chip, { x: 0, y: 0, width: 0, height: 0 });
  }, [chip, onOpen]);

  return (
    <Text
      ref={spanRef}
      accessibilityRole="button"
      accessibilityLabel={chip.label}
      onPress={openFromNode}
      {...(isWeb ? { onPointerEnter: openFromNode, onPointerLeave: () => undefined } : {})}
      suppressHighlighting
      style={[
        styles.chip,
        {
          backgroundColor: chrome.backgroundColor,
          color: chrome.color,
          borderColor: chrome.borderColor,
        },
      ]}
      testID="queued-inline-chip"
    >
      {chip.label}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[1],
    minWidth: 0,
    flexShrink: 1,
  },
  attachments: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  thumbnail: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.sm,
    overflow: "hidden",
    ...(isWeb ? { cursor: "pointer" as const } : {}),
  },
  attachmentCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize["2xs"],
  },
  skill: {
    color: theme.colors.accent,
  },
  chip: (() => {
    const chrome = inlineChipChromeFromTheme(theme);
    return {
      borderWidth: chrome.borderWidth,
      borderRadius: chrome.borderRadius,
      paddingHorizontal: chrome.paddingHorizontal,
      paddingVertical: chrome.paddingVertical,
      ...(isWeb ? { userSelect: "none" as const, cursor: "pointer" as const } : {}),
    };
  })(),
}));
