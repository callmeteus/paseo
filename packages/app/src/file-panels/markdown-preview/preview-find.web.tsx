import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { PaneFind, findShortcutPlatform, isFindShortcut, type PaneFindHandle } from "@/pane-find";
import { usePaneFocus } from "@/panels/pane-context";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { hasActiveOverlay } from "@/keyboard";
import { isImeComposingKeyboardEvent } from "@/utils/keyboard-ime";
import { findRenderedMatches } from "@/agent-stream/chat-find/ranges.web";
import type { Theme } from "@/styles/theme";

let nextHighlightId = 0;

/**
 * Find for the rendered markdown preview. It searches the preview DOM directly
 * (the source Find needs a CodeMirror view and the chat Find needs timeline RPCs,
 * neither of which exists here) and highlights matches with CSS.highlights.
 */
export function MarkdownPreviewFind({
  root,
  scrollContainer,
}: {
  root: React.RefObject<HTMLElement | null>;
  scrollContainer: React.RefObject<HTMLElement | null>;
}): ReactElement | null {
  const { t } = useTranslation();
  const widget = useRef<PaneFindHandle>(null);
  const [highlightName] = useState(() => `paseo-md-preview-find-${++nextHighlightId}`);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [ranges, setRanges] = useState<Range[]>([]);
  const [occurrence, setOccurrence] = useState(0);
  const { isInteractive } = usePaneFocus();
  const active = useRetainedPanelActive();

  const clear = useCallback(() => {
    if (typeof CSS !== "undefined" && CSS.highlights) CSS.highlights.delete(highlightName);
  }, [highlightName]);

  useEffect(() => {
    if (!active) {
      setOpen(false);
      clear();
    }
  }, [active, clear]);
  useEffect(() => clear, [clear]);

  useEffect(() => {
    if (!open || !active || !isInteractive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || hasActiveOverlay() || isImeComposingKeyboardEvent(event))
        return;
      // RN Web TextInputs stop bubbling; the widget handles a repeat itself.
      if (isFindShortcut(event, findShortcutPlatform())) {
        event.preventDefault();
        widget.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, active, isInteractive]);

  useEffect(() => {
    if (!open || !root.current) return;
    const found = findRenderedMatches(root.current, query, true);
    setRanges(found);
    setOccurrence((current) => (found.length ? Math.min(current, found.length - 1) : 0));
  }, [query, open, root]);

  const select = useCallback(
    (index: number) => {
      if (!ranges.length) return;
      const next = ((index % ranges.length) + ranges.length) % ranges.length;
      setOccurrence(next);
      const range = ranges[next];
      if (!range) return;
      if (CSS.highlights) CSS.highlights.set(highlightName, new Highlight(range));
      const target = range.getBoundingClientRect();
      const container = scrollContainer.current;
      if (container && target.height) {
        const box = container.getBoundingClientRect();
        if (target.top < box.top || target.bottom > box.bottom) {
          container.scrollTo({
            top: container.scrollTop + (target.top - box.top) - box.height / 2,
            behavior: "smooth",
          });
        }
      }
    },
    [highlightName, ranges, scrollContainer],
  );

  const next = useCallback(() => select(occurrence + 1), [select, occurrence]);
  const previous = useCallback(() => select(occurrence - 1), [select, occurrence]);
  const close = useCallback(() => {
    setOpen(false);
    clear();
  }, [clear]);

  const openFind = useCallback(() => {
    setOpen(true);
  }, []);

  // Allow the panel/toolbar to open this Find on Ctrl+F when nothing has focus.
  useEffect(() => {
    if (!active || !isInteractive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || hasActiveOverlay() || isImeComposingKeyboardEvent(event))
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, [contenteditable="true"]')
      ) {
        return;
      }
      if (isFindShortcut(event, findShortcutPlatform())) {
        event.preventDefault();
        openFind();
        // Focus after the widget mounts.
        requestAnimationFrame(() => widget.current?.focus());
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active, isInteractive, openFind]);

  let status = "";
  if (query.trim()) {
    status = ranges.length
      ? t("paneFind.position", { current: occurrence + 1, total: ranges.length })
      : t("paneFind.noMatches");
  }

  return (
    <div style={ROOT_STYLE} data-testid="markdown-preview-find">
      <style>{`::highlight(${highlightName}) { background-color: #f5c51866; color: inherit; }`}</style>
      {open ? (
        <View style={styles.overlay}>
          <PaneFind
            ref={widget}
            query={query}
            status={status}
            canNavigate={ranges.length > 0}
            onQueryChange={setQuery}
            onNext={next}
            onPrevious={previous}
            onClose={close}
          />
        </View>
      ) : null}
    </div>
  );
}

const ROOT_STYLE = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
} as const;

const styles = StyleSheet.create((_theme: Theme) => ({
  root: {
    position: "absolute" as const,
    top: 0,
    right: 0,
    left: 0,
    bottom: 0,
    pointerEvents: "box-none" as const,
  },
  overlay: {
    position: "absolute" as const,
    top: 8,
    right: 12,
    zIndex: 10,
  },
}));
