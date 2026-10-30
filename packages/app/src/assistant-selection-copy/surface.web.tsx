import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { createPortal } from "react-dom";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { getOverlayRoot } from "@/lib/overlay-root";
import { createAssistantSelectionClipboardContent } from "./content.web";

interface AssistantSelectionCopySurfaceProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** When set, a floating action adds the selected chat text to the composer. */
  onAddSelectionToChat?: (text: string) => void;
}

interface SelectionAction {
  text: string;
  top: number;
  left: number;
}

const DISPLAY_CONTENTS: CSSProperties = { display: "contents" };
const ACTION_WIDTH = 148;
const ACTION_HEIGHT = 36;
const ACTION_GAP = 8;
const VIEWPORT_MARGIN = 8;

export function AssistantSelectionCopySurface({
  children,
  style,
  onAddSelectionToChat,
}: AssistantSelectionCopySurfaceProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [action, setAction] = useState<SelectionAction | null>(null);

  const handleCopy = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const content = createAssistantSelectionClipboardContent(window.getSelection());
    if (!content) {
      return;
    }

    event.preventDefault();
    event.clipboardData.setData("text/plain", content.plainText);
    event.clipboardData.setData("text/html", content.html);
  }, []);

  useEffect(() => {
    if (!onAddSelectionToChat) {
      setAction(null);
      return;
    }

    const update = () => {
      const selection = window.getSelection();
      const root = rootRef.current;
      if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !root) {
        setAction(null);
        return;
      }
      const anchor = selection.anchorNode;
      const focus = selection.focusNode;
      if (!anchor || !focus || !root.contains(anchor) || !root.contains(focus)) {
        setAction(null);
        return;
      }
      const text = selection.toString().trim();
      if (!text) {
        setAction(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setAction(null);
        return;
      }
      const placeAbove = rect.top >= ACTION_HEIGHT + ACTION_GAP + VIEWPORT_MARGIN;
      const rawTop = placeAbove ? rect.top - ACTION_HEIGHT - ACTION_GAP : rect.bottom + ACTION_GAP;
      const maxTop = window.innerHeight - ACTION_HEIGHT - VIEWPORT_MARGIN;
      const top = Math.min(Math.max(VIEWPORT_MARGIN, rawTop), maxTop);
      const centeredLeft = rect.left + rect.width / 2 - ACTION_WIDTH / 2;
      const maxLeft = window.innerWidth - ACTION_WIDTH - VIEWPORT_MARGIN;
      const left = Math.min(Math.max(VIEWPORT_MARGIN, centeredLeft), maxLeft);
      setAction({ text, top, left });
    };

    const scheduleUpdate = () => {
      window.requestAnimationFrame(update);
    };

    document.addEventListener("selectionchange", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      document.removeEventListener("selectionchange", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [onAddSelectionToChat]);

  const handleAddSelection = useCallback(() => {
    if (!action || !onAddSelectionToChat) {
      return;
    }
    onAddSelectionToChat(action.text);
    window.getSelection()?.removeAllRanges();
    setAction(null);
  }, [action, onAddSelectionToChat]);

  return (
    <div ref={rootRef} onCopy={handleCopy} style={DISPLAY_CONTENTS}>
      <View style={style}>{children}</View>
      {action && onAddSelectionToChat
        ? createPortal(
            <View
              pointerEvents="box-none"
              style={[styles.actionAnchor, { top: action.top, left: action.left }]}
            >
              <Button
                variant="outline"
                size="sm"
                onPress={handleAddSelection}
                style={styles.actionButton}
                textStyle={styles.actionLabel}
                accessibilityLabel={t("agentStream.addSelectionToChat")}
                testID="add-selection-to-chat"
              >
                {t("agentStream.addSelectionToChat")}
              </Button>
            </View>,
            getOverlayRoot(),
          )
        : null}
    </div>
  );
}

const styles = StyleSheet.create((theme) => ({
  actionAnchor: {
    position: "absolute",
    width: ACTION_WIDTH,
  },
  actionButton: {
    height: ACTION_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    shadowColor: "#000000",
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  actionLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
}));
