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
import { useRetainedPanelActive } from "@/components/retained-panel";
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
const ACTION_ATTRIBUTE = "data-paseo-selection-chat-action";
const ACTION_DATASET: Record<string, string> = { paseoSelectionChatAction: "true" };
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
  const isPanelActive = useRetainedPanelActive();

  // Switching tabs keeps this panel mounted but hidden while the DOM selection
  // remains in it. Drop the floating action so it cannot outlive its tab.
  useEffect(() => {
    if (!isPanelActive) {
      setAction(null);
    }
  }, [isPanelActive]);

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
      // A retained panel that is display:none still owns the selection, but its
      // range has no client rects. Check the range, not the root: the root is
      // display:contents and never has a box of its own.
      const range = selection.getRangeAt(0);
      if (range.getClientRects().length === 0) {
        setAction(null);
        return;
      }
      const text = selection.toString().trim();
      if (!text) {
        setAction(null);
        return;
      }
      const rect = range.getBoundingClientRect();
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

    // Any click outside the action and this surface dismisses it. Clicks on the
    // action itself must survive so its onPress can run.
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(`[${ACTION_ATTRIBUTE}="true"]`)) {
        return;
      }
      setAction(null);
    };
    const clear = () => setAction(null);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") clear();
    };

    document.addEventListener("selectionchange", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("selectionchange", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
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
              dataSet={ACTION_DATASET}
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
