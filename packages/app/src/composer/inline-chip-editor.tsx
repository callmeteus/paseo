import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import type { EditingTextInputHandle } from "@/components/ui/text-input/types";
import {
  insertTextAtSelection,
  parseInlineParts,
  removeAdjacentInlineChip,
  serializeInlineChip,
  type InlineChip,
  type TextSelection,
} from "@getpaseo/protocol/inline-chip";
import { findSkillHighlightRanges } from "@/utils/agent-command-autocomplete";
import { applyInlineChipDomStyle } from "./inline-chip-chrome";
import { InlineChipDisclosure } from "./inline-context-chip";

const chipStore = new WeakMap<HTMLElement, InlineChip>();

export interface InlineChipEditorProps {
  initialText: string;
  initialSelection: TextSelection;
  style?: StyleProp<TextStyle>;
  editable: boolean;
  accessibilityLabel: string;
  onChangeText: (text: string) => void;
  onSelectionChange: (selection: TextSelection) => void;
  onKeyPress?: (event: globalThis.KeyboardEvent) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  skillNames?: readonly string[];
  skillColor?: string;
}

/**
 * The composer once it contains a chip. A textarea cannot draw a clickable atom, so this
 * contenteditable shows the label and keeps the stored marker string as its value.
 * React owns no children here: a parent render would wipe the DOM, and the layout effect
 * puts the chips back before paint.
 */
export const InlineChipEditor = forwardRef<EditingTextInputHandle, InlineChipEditorProps>(
  function InlineChipEditor(props, ref) {
    const { t } = useTranslation();
    const rootRef = useRef<HTMLDivElement>(null);
    const textRef = useRef(props.initialText);
    const selectionRef = useRef<TextSelection>(props.initialSelection);
    const restoringRef = useRef(false);
    const composingRef = useRef(false);
    const onChangeTextRef = useRef(props.onChangeText);
    const onSelectionChangeRef = useRef(props.onSelectionChange);
    const onKeyPressRef = useRef(props.onKeyPress);
    const onFocusRef = useRef(props.onFocus);
    const onBlurRef = useRef(props.onBlur);
    const skillNamesRef = useRef(props.skillNames ?? NO_SKILL_NAMES);
    const skillColorRef = useRef(props.skillColor ?? "");
    const rangeSignatureRef = useRef("");
    const paintedSignatureRef = useRef("");
    onChangeTextRef.current = props.onChangeText;
    onSelectionChangeRef.current = props.onSelectionChange;
    onKeyPressRef.current = props.onKeyPress;
    onFocusRef.current = props.onFocus;
    onBlurRef.current = props.onBlur;
    skillNamesRef.current = props.skillNames ?? NO_SKILL_NAMES;
    skillColorRef.current = props.skillColor ?? "";
    const [preview, setPreview] = useState<{ chip: InlineChip; anchor: DOMRect } | null>(null);

    const publish = useCallback((text: string, selection: TextSelection) => {
      textRef.current = text;
      selectionRef.current = selection;
      onChangeTextRef.current(text);
      onSelectionChangeRef.current(selection);
    }, []);

    const paint = useCallback((text: string, selection: TextSelection) => {
      const root = rootRef.current;
      if (!root) return;
      restoringRef.current = true;
      renderDocument(root, text, {
        names: skillNamesRef.current,
        color: skillColorRef.current,
      });
      rangeSignatureRef.current = skillRangeSignature(text, skillNamesRef.current);
      paintedSignatureRef.current = skillPaintSignature(
        skillNamesRef.current,
        skillColorRef.current,
      );
      setRawSelection(root, selection);
      restoringRef.current = false;
    }, []);

    const skillSignature = skillPaintSignature(skillNamesRef.current, skillColorRef.current);
    // React renders this div with no children, so a parent render wipes the chips.
    // Restore before paint on every commit, not only on mount.
    useLayoutEffect(() => {
      const root = rootRef.current;
      if (!root || restoringRef.current) return;
      if (
        readDocument(root) === textRef.current &&
        paintedSignatureRef.current === skillSignature
      ) {
        return;
      }
      paint(textRef.current, selectionRef.current);
    });

    useImperativeHandle(
      ref,
      () => ({
        focus() {
          rootRef.current?.focus();
        },
        blur() {
          rootRef.current?.blur();
        },
        isFocused() {
          return document.activeElement === rootRef.current;
        },
        getText() {
          return textRef.current;
        },
        replaceText(text: string, selection?: TextSelection) {
          const nextSelection = selection ?? { start: text.length, end: text.length };
          textRef.current = text;
          selectionRef.current = nextSelection;
          paint(text, nextSelection);
        },
        setSelection(selection: TextSelection) {
          selectionRef.current = selection;
          const root = rootRef.current;
          if (!root) return;
          restoringRef.current = true;
          setRawSelection(root, selection);
          restoringRef.current = false;
        },
        reset() {
          textRef.current = "";
          selectionRef.current = { start: 0, end: 0 };
          paint("", { start: 0, end: 0 });
        },
        getNativeRef() {
          return rootRef.current;
        },
      }),
      [paint],
    );

    const readCaret = useCallback((): TextSelection => {
      const root = rootRef.current;
      if (!root) return selectionRef.current;
      return readSelection(root, selectionRef.current);
    }, []);

    const handleInput = useCallback(() => {
      if (restoringRef.current || composingRef.current) return;
      const root = rootRef.current;
      if (!root) return;
      const text = readDocument(root);
      const selection = readSelection(root, selectionRef.current);
      if (text !== textRef.current) publish(text, selection);
      const signature = skillRangeSignature(text, skillNamesRef.current);
      if (signature === rangeSignatureRef.current) return;
      paint(text, selection);
    }, [paint, publish]);

    const handleKeyDown = useCallback(
      (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const native = event.nativeEvent;
        if (native.isComposing || native.keyCode === 229) return;
        const selection = readCaret();
        selectionRef.current = selection;
        onSelectionChangeRef.current(selection);
        if (native.key === "Backspace" || native.key === "Delete") {
          const removed = removeAdjacentInlineChip({
            text: textRef.current,
            selection,
            direction: native.key === "Backspace" ? "backward" : "forward",
          });
          if (removed) {
            event.preventDefault();
            paint(removed.text, removed.selection);
            publish(removed.text, removed.selection);
            return;
          }
        }
        if (
          native.key === "Enter" &&
          native.shiftKey &&
          !native.metaKey &&
          !native.ctrlKey &&
          !native.altKey
        ) {
          event.preventDefault();
          const next = insertTextAtSelection({
            text: textRef.current,
            selection,
            insert: "\n",
          });
          paint(next.text, next.selection);
          publish(next.text, next.selection);
          return;
        }
        onKeyPressRef.current?.(native);
      },
      [paint, publish, readCaret],
    );

    const handleBeforeInput = useCallback(
      (event: FormEvent<HTMLDivElement>) => {
        const native = event.nativeEvent;
        if (!(native instanceof InputEvent)) return;
        if (native.inputType !== "insertParagraph" && native.inputType !== "insertLineBreak")
          return;
        event.preventDefault();
        const selection = readCaret();
        const next = insertTextAtSelection({
          text: textRef.current,
          selection,
          insert: "\n",
        });
        paint(next.text, next.selection);
        publish(next.text, next.selection);
      },
      [paint, publish, readCaret],
    );

    const handleMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
      const chip = chipElementFromEvent(event.nativeEvent);
      if (!chip) return;
      event.preventDefault();
      const stored = chipStore.get(chip);
      if (!stored) return;
      setPreview({ chip: stored, anchor: chip.getBoundingClientRect() });
    }, []);

    const handleFocus = useCallback(() => {
      onFocusRef.current?.();
    }, []);
    const handleBlur = useCallback(() => {
      onBlurRef.current?.();
    }, []);
    const handleCompositionStart = useCallback(() => {
      composingRef.current = true;
    }, []);
    const handleCompositionEnd = useCallback(() => {
      composingRef.current = false;
      handleInput();
    }, [handleInput]);
    const handleClosePreview = useCallback(() => setPreview(null), []);
    const previewAnchor = useMemo(
      () =>
        preview
          ? {
              x: preview.anchor.left,
              y: preview.anchor.top,
              width: preview.anchor.width,
              height: preview.anchor.height,
            }
          : null,
      [preview],
    );

    const handleSelection = useCallback(() => {
      if (restoringRef.current) return;
      const root = rootRef.current;
      const selection = document.getSelection();
      if (!root || !selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.startContainer)) return;
      const next = readSelection(root, selectionRef.current);
      selectionRef.current = next;
      onSelectionChangeRef.current(next);
    }, []);

    useEffect(() => {
      document.addEventListener("selectionchange", handleSelection);
      return () => document.removeEventListener("selectionchange", handleSelection);
    }, [handleSelection]);

    // The composer measures this like the textarea, whose style is a TextStyle.
    return (
      <View style={props.style as StyleProp<ViewStyle>}>
        <div
          ref={rootRef}
          contentEditable={props.editable}
          role="textbox"
          aria-multiline="true"
          aria-label={props.accessibilityLabel}
          data-inline-chip-editor="true"
          data-composer-input=""
          suppressContentEditableWarning
          spellCheck={false}
          style={editorDomStyle}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onBeforeInput={handleBeforeInput}
          onMouseDown={handleMouseDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
        />
        {preview && previewAnchor ? (
          <InlineChipDisclosure
            chip={preview.chip}
            anchor={previewAnchor}
            emptyBody={t("composer.inlineChip.mentionLoading")}
            onClose={handleClosePreview}
          />
        ) : null}
      </View>
    );
  },
);

const editorDomStyle: CSSProperties = {
  width: "100%",
  minHeight: "100%",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  overflowY: "auto",
  outline: "none",
  font: "inherit",
  color: "inherit",
  boxSizing: "border-box",
};

const NO_SKILL_NAMES: readonly string[] = [];

interface SkillPaint {
  names: readonly string[];
  color: string;
}

function skillPaintSignature(names: readonly string[], color: string): string {
  return `${color}\n${names.join("\n")}`;
}

function skillRangeSignature(text: string, names: readonly string[]): string {
  return findSkillHighlightRanges(text, names)
    .map((range) => `${range.start}:${range.end}`)
    .join(",");
}

function renderDocument(root: HTMLElement, text: string, skills: SkillPaint): void {
  root.replaceChildren();
  for (const part of parseInlineParts(text)) {
    if (part.kind === "text") {
      appendText(root, part.text, skills);
      continue;
    }
    root.appendChild(createChipElement(part.chip));
  }
}

function appendText(root: HTMLElement, text: string, skills: SkillPaint): void {
  const ranges = findSkillHighlightRanges(text, skills.names);
  if (ranges.length === 0) {
    appendPlainText(root, text);
    return;
  }
  let cursor = 0;
  for (const range of ranges) {
    appendPlainText(root, text.slice(cursor, range.start));
    appendSkillText(root, text.slice(range.start, range.end), skills.color);
    cursor = range.end;
  }
  appendPlainText(root, text.slice(cursor));
}

function appendPlainText(root: HTMLElement, text: string): void {
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) root.appendChild(document.createElement("br"));
    if (line.length > 0) root.appendChild(document.createTextNode(line));
  });
}

function appendSkillText(root: HTMLElement, text: string, color: string): void {
  if (text.length === 0) return;
  const span = document.createElement("span");
  span.dataset.skillMention = "true";
  if (color) span.style.color = color;
  span.textContent = text;
  root.appendChild(span);
}

function createChipElement(chip: InlineChip): HTMLSpanElement {
  const span = document.createElement("span");
  span.dataset.inlineChip = "true";
  span.contentEditable = "false";
  span.textContent = chip.label;
  span.setAttribute("role", "button");
  applyInlineChipDomStyle(span);
  chipStore.set(span, chip);
  return span;
}

function readDocument(root: HTMLElement): string {
  const children = [...root.childNodes];
  const blocks =
    children.length > 0 &&
    children.every(
      (child) => child instanceof HTMLElement && (child.tagName === "DIV" || child.tagName === "P"),
    );
  if (blocks) return children.map((child) => readElement(child as HTMLElement)).join("\n");
  return readElement(root);
}

function readElement(element: HTMLElement): string {
  let text = "";
  element.childNodes.forEach((child) => {
    text += readNode(child);
  });
  return text;
}

function readNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  const chip = chipStore.get(node);
  if (chip) return serializeInlineChip(chip);
  if (node.tagName === "BR") return "\n";
  const inner = readElement(node);
  if (node.tagName === "DIV" || node.tagName === "P") return `\n${inner}`;
  return inner;
}

function readSelection(root: HTMLElement, fallback: TextSelection): TextSelection {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return fallback;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return fallback;
  const start = rawOffset(root, range.startContainer, range.startOffset);
  const end = rawOffset(root, range.endContainer, range.endOffset);
  return start <= end ? { start, end } : { start: end, end: start };
}

function rawOffset(root: HTMLElement, container: Node, offset: number): number {
  let total = 0;
  let found = false;
  const visit = (node: Node): void => {
    if (found) return;
    if (node === container) {
      if (node.nodeType === Node.TEXT_NODE) {
        total += Math.min(offset, node.textContent?.length ?? 0);
      } else {
        const children = node.childNodes;
        for (let index = 0; index < offset && index < children.length; index += 1) {
          total += serializedLength(children[index]!);
        }
      }
      found = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      total += node.textContent?.length ?? 0;
      return;
    }
    if (node instanceof HTMLElement && chipStore.has(node)) {
      total += serializedLength(node);
      return;
    }
    if (node instanceof HTMLElement && node.tagName === "BR") {
      total += 1;
      return;
    }
    node.childNodes.forEach((child) => visit(child));
  };
  visit(root);
  return found ? total : serializedLength(root);
}

function serializedLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (!(node instanceof HTMLElement)) return 0;
  const chip = chipStore.get(node);
  if (chip) return serializeInlineChip(chip).length;
  if (node.tagName === "BR") return 1;
  let total = 0;
  node.childNodes.forEach((child) => {
    total += serializedLength(child);
  });
  return total;
}

function setRawSelection(root: HTMLElement, selection: TextSelection): void {
  const range = document.createRange();
  const start = placeOffset(root, selection.start);
  const end = placeOffset(root, selection.end);
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const selected = document.getSelection();
  if (!selected) return;
  selected.removeAllRanges();
  selected.addRange(range);
}

function placeOffset(root: HTMLElement, target: number): { node: Node; offset: number } {
  let remaining = Math.max(0, target);
  const visit = (node: Node): { node: Node; offset: number } | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) return { node, offset: remaining };
      remaining -= length;
      return null;
    }
    if (node instanceof HTMLElement && chipStore.has(node)) {
      const length = serializedLength(node);
      const parent = node.parentNode ?? root;
      if (remaining <= 0) return { node: parent, offset: childIndex(node) };
      if (remaining <= length) return { node: parent, offset: childIndex(node) + 1 };
      remaining -= length;
      return null;
    }
    if (node instanceof HTMLElement && node.tagName === "BR") {
      const parent = node.parentNode ?? root;
      if (remaining <= 0) return { node: parent, offset: childIndex(node) };
      remaining -= 1;
      return null;
    }
    for (const child of node.childNodes) {
      const placed = visit(child);
      if (placed) return placed;
    }
    return null;
  };
  return visit(root) ?? { node: root, offset: root.childNodes.length };
}

function childIndex(node: Node): number {
  const parent = node.parentNode;
  if (!parent) return 0;
  return Array.prototype.indexOf.call(parent.childNodes, node);
}

function chipElementFromEvent(event: MouseEvent): HTMLElement | null {
  const target = event.target;
  let element: HTMLElement | null = null;
  if (target instanceof HTMLElement) {
    element = target;
  } else if (target instanceof Node) {
    element = target.parentElement;
  }
  const chip = element?.closest("[data-inline-chip='true']");
  return chip instanceof HTMLElement ? chip : null;
}
