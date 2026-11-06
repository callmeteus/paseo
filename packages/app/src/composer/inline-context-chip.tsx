import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import {
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { DropdownMenu, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { useMenuContext } from "@/components/ui/menu";
import type { Rect } from "@/components/ui/anchor";
import { isWeb } from "@/constants/platform";
import { hasInlineChip, parseInlineParts, type InlineChip } from "@getpaseo/protocol/inline-chip";
import { inlineChipChrome } from "./inline-chip-chrome";

const PREVIEW_WIDTH = 420;
const PREVIEW_MAX_HEIGHT = 320;

interface InlineChipDisclosureProps {
  chip: InlineChip;
  anchor: Rect;
  emptyBody: string;
  onClose: () => void;
}

/**
 * The full paste or mentioned chat, in the menu the app already uses for press-to-open
 * panels. The chip sets the anchor; this does not invent a second modal.
 */
export function InlineChipDisclosure({
  chip,
  anchor,
  emptyBody,
  onClose,
}: InlineChipDisclosureProps) {
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  const body = chip.body.length > 0 ? chip.body : emptyBody;
  return (
    <DropdownMenu open onOpenChange={handleOpenChange} compactMode="sheet">
      <InlineChipAnchor rect={anchor} />
      <DropdownMenuContent
        side="top"
        width={PREVIEW_WIDTH}
        maxHeight={PREVIEW_MAX_HEIGHT}
        scrollable
        sheetTitle={chip.label}
        testID="inline-context-chip-preview"
      >
        <Text selectable style={styles.preview}>
          {body}
        </Text>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InlineChipAnchor({ rect }: { rect: Rect }) {
  const { setAnchorRect } = useMenuContext("InlineChipAnchor");
  useLayoutEffect(() => {
    setAnchorRect(rect);
  }, [rect, setAnchorRect]);
  return null;
}

interface InlineMessageTextProps {
  text: string;
  style?: StyleProp<TextStyle>;
  dataSet?: { messageText: string };
}

/**
 * A sent message with chips in the sentence. Text without a chip stays a plain `Text`,
 * so this is only the branch that has something to disclose.
 */
export function InlineMessageText({ text, style, dataSet }: InlineMessageTextProps) {
  const { t } = useTranslation();
  const parts = useMemo(() => parseInlineParts(text), [text]);
  const keyedParts = useMemo(() => {
    let offset = 0;
    return parts.map((part) => {
      const key = part.kind === "text" ? `text-${offset}` : `${part.chip.id}@${offset}`;
      offset += part.kind === "text" ? part.text.length : part.chip.id.length;
      offset += 1;
      return { key, part };
    });
  }, [parts]);
  const [open, setOpen] = useState<{ chip: InlineChip; anchor: Rect } | null>(null);
  const handleOpen = useCallback((chip: InlineChip, anchor: Rect) => {
    setOpen({ chip, anchor });
  }, []);
  const handleClose = useCallback(() => setOpen(null), []);
  if (!hasInlineChip(text)) {
    return <Text style={style}>{text}</Text>;
  }
  const emptyBody = t("composer.inlineChip.mentionLoading");
  return (
    <View>
      <Text selectable style={style} dataSet={dataSet}>
        {keyedParts.map(({ key, part }) =>
          part.kind === "text" ? (
            <Text key={key}>{part.text}</Text>
          ) : (
            <InlineChipSpan key={key} chip={part.chip} onOpen={handleOpen} />
          ),
        )}
      </Text>
      {open ? (
        <InlineChipDisclosure
          chip={open.chip}
          anchor={open.anchor}
          emptyBody={emptyBody}
          onClose={handleClose}
        />
      ) : null}
    </View>
  );
}

function InlineChipSpan({
  chip,
  onOpen,
}: {
  chip: InlineChip;
  onOpen: (chip: InlineChip, anchor: Rect) => void;
}) {
  const spanRef = useRef<ComponentRef<typeof Text>>(null);
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      const node = spanRef.current;
      if (node && typeof node.measureInWindow === "function") {
        node.measureInWindow((x, y, width, height) => {
          onOpen(chip, { x, y, width, height });
        });
        return;
      }
      onOpen(chip, {
        x: event.nativeEvent.pageX,
        y: event.nativeEvent.pageY,
        width: 0,
        height: 0,
      });
    },
    [chip, onOpen],
  );
  return (
    <Text
      ref={spanRef}
      accessibilityRole="button"
      accessibilityLabel={chip.label}
      onPress={handlePress}
      suppressHighlighting
      style={styles.chip}
      testID="inline-context-chip"
    >
      {chip.label}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  chip: {
    backgroundColor: inlineChipChrome.backgroundColor,
    color: inlineChipChrome.color,
    borderRadius: inlineChipChrome.borderRadius,
    paddingHorizontal: inlineChipChrome.paddingHorizontal,
    paddingVertical: inlineChipChrome.paddingVertical,
    ...(isWeb ? { userSelect: "none" as const } : {}),
  },
  preview: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    ...(isWeb ? { whiteSpace: "pre-wrap" as const, overflowWrap: "anywhere" as const } : {}),
  },
}));
