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
} from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  Annotation,
  Compartment,
  EditorState,
  Prec,
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, redo, undo } from "@codemirror/commands";
import { Decoration, EditorView, keymap, WidgetType, type DecorationSet } from "@codemirror/view";
import type { EditingTextInputHandle } from "@/components/ui/text-input/types";
import type { Theme } from "@/styles/theme";
import {
  expandInlineChips,
  insertTextAtSelection,
  parseInlineParts,
  serializeInlineChip,
  type InlineChip,
  type TextSelection,
} from "@getpaseo/protocol/inline-chip";
import { continueComposerList, findComposerInlineCode } from "@/composer/list-format";
import { findSkillHighlightRanges } from "@/utils/agent-command-autocomplete";
import { applyInlineChipDomStyle, getUnistylesAppTheme } from "./inline-chip-chrome";
import { InlineChipDisclosure } from "./inline-context-chip";
import type { InlineChipEditSnapshot, InlineChipEditorProps } from "./inline-chip-editor-api";

export type { InlineChipEditSnapshot, InlineChipEditorProps };

const externalChange = Annotation.define<true>();
const setPaint = StateEffect.define<ComposerPaint>();

interface ComposerPaint {
  names: readonly string[];
  color: string;
  epoch: number;
}

interface ComposerDecorations {
  visual: DecorationSet;
  backticks: DecorationSet;
  atomic: DecorationSet;
}

const paintField = StateField.define<ComposerPaint>({
  create: () => EMPTY_PAINT,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setPaint)) return effect.value;
    }
    return value;
  },
});

const decorationsField = StateField.define<ComposerDecorations>({
  create(state) {
    return buildDecorations(state);
  },
  update(value, transaction) {
    const paintChanged = transaction.effects.some((effect) => effect.is(setPaint));
    if (!transaction.docChanged && !paintChanged) return value;
    return buildDecorations(transaction.state);
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.visual),
    EditorView.decorations.from(field, (value) => value.backticks),
    EditorView.atomicRanges.from(field, (value) => () => value.atomic),
  ],
});

const chipPressByView = new WeakMap<EditorView, (chip: InlineChip, rect: DOMRect) => void>();

/**
 * The composer once it contains a chip. A textarea cannot draw a clickable atom.
 * CodeMirror owns the caret, the line breaks, and undo. The document stays the
 * stored marker string, and each chip is an atomic widget in the same chrome.
 */
export const InlineChipEditor = forwardRef<EditingTextInputHandle, InlineChipEditorProps>(
  function InlineChipEditor(props, ref) {
    const { t } = useTranslation();
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const extensionsRef = useRef<Extension>([]);
    const textRef = useRef(props.initialText);
    const selectionRef = useRef<TextSelection>(props.initialSelection);
    const undoBaselineRef = useRef(props.undoBaseline ?? null);
    const onChangeTextRef = useRef(props.onChangeText);
    const onSelectionChangeRef = useRef(props.onSelectionChange);
    const onKeyPressRef = useRef(props.onKeyPress);
    const onFocusRef = useRef(props.onFocus);
    const onBlurRef = useRef(props.onBlur);
    const openPreviewRef = useRef<(chip: InlineChip, rect: DOMRect) => void>(() => {});
    const paintSignatureRef = useRef("");
    const editableCompartmentRef = useRef(new Compartment());
    const [themeEpoch, setThemeEpoch] = useState(0);
    const [preview, setPreview] = useState<{ chip: InlineChip; anchor: DOMRect } | null>(null);
    onChangeTextRef.current = props.onChangeText;
    onSelectionChangeRef.current = props.onSelectionChange;
    onKeyPressRef.current = props.onKeyPress;
    onFocusRef.current = props.onFocus;
    onBlurRef.current = props.onBlur;
    openPreviewRef.current = (chip, rect) => setPreview({ chip, anchor: rect });

    const publishPaint = useMemo(
      () => (view: EditorView, paint: ComposerPaint) => {
        const signature = paintKey(paint);
        if (signature === paintSignatureRef.current) return;
        paintSignatureRef.current = signature;
        view.dispatch({
          effects: setPaint.of(paint),
          annotations: externalChange.of(true),
        });
      },
      [],
    );

    useLayoutEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      const paint = currentPaint(props.skillNames, props.skillColor, 0);
      paintSignatureRef.current = paintKey(paint);
      const extensions = editorExtensions({
        editable: editableCompartmentRef.current.of(EditorView.editable.of(props.editable)),
        accessibilityLabel: props.accessibilityLabel,
        onKeyPressRef,
        onChangeTextRef,
        onSelectionChangeRef,
        onFocusRef,
        onBlurRef,
        textRef,
        selectionRef,
      });
      extensionsRef.current = extensions;
      const baseline = undoBaselineRef.current;
      undoBaselineRef.current = null;
      const initialText = textRef.current;
      const initialSelection = selectionRef.current;
      const seeded = baseline != null;
      const startText = seeded ? baseline.text : initialText;
      const startSelection = seeded ? baseline.selection : initialSelection;
      let state = EditorState.create({
        doc: startText,
        selection: clampSelection(startText.length, startSelection),
        extensions,
      });
      state = state.update({ effects: setPaint.of(paint) }).state;
      const view = new EditorView({ state, parent: host });
      viewRef.current = view;
      chipPressByView.set(view, (chip, rect) => openPreviewRef.current(chip, rect));
      view.scrollDOM.dataset.composerInput = "";
      const onBeforeInput = (event: Event) => {
        if (!(event instanceof InputEvent)) return;
        if (event.inputType !== "historyUndo" && event.inputType !== "historyRedo") return;
        event.preventDefault();
        const command = event.inputType === "historyUndo" ? undo : redo;
        command(view);
      };
      view.contentDOM.addEventListener("beforeinput", onBeforeInput, true);
      if (seeded && baseline.text !== initialText) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: initialText },
          selection: clampSelection(initialText.length, initialSelection),
          annotations: externalChange.of(true),
        });
      }
      return () => {
        view.contentDOM.removeEventListener("beforeinput", onBeforeInput, true);
        chipPressByView.delete(view);
        view.destroy();
        viewRef.current = null;
      };
      // The view is created once. Later text arrives through replaceText.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      publishPaint(view, currentPaint(props.skillNames, props.skillColor, themeEpoch));
    }, [props.skillColor, props.skillNames, publishPaint, themeEpoch]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      if (view.state.facet(EditorView.editable) === props.editable) return;
      view.dispatch({
        effects: editableCompartmentRef.current.reconfigure(EditorView.editable.of(props.editable)),
        annotations: externalChange.of(true),
      });
    }, [props.editable]);

    useEffect(() => {
      viewRef.current?.contentDOM.setAttribute("aria-label", props.accessibilityLabel);
    }, [props.accessibilityLabel]);

    const bumpThemeEpoch = useCallback(() => {
      setThemeEpoch((previous) => previous + 1);
    }, []);
    useEffect(() => StyleSheet.addChangeListener(bumpThemeEpoch), [bumpThemeEpoch]);

    useImperativeHandle(
      ref,
      () => ({
        focus() {
          const view = viewRef.current;
          if (!view) return;
          view.focus();
          const selection = selectionRef.current;
          view.dispatch({
            selection: clampSelection(view.state.doc.length, selection),
            annotations: externalChange.of(true),
          });
        },
        blur() {
          viewRef.current?.contentDOM.blur();
        },
        isFocused() {
          return viewRef.current?.hasFocus ?? false;
        },
        getText() {
          return viewRef.current?.state.doc.toString() ?? textRef.current;
        },
        replaceText(text: string, selection?: TextSelection) {
          const view = viewRef.current;
          const nextSelection = selection ?? { start: text.length, end: text.length };
          textRef.current = text;
          selectionRef.current = nextSelection;
          if (!view) return;
          const current = view.state.doc.toString();
          view.dispatch({
            changes: current === text ? undefined : { from: 0, to: current.length, insert: text },
            selection: clampSelection(text.length, nextSelection),
            annotations: externalChange.of(true),
          });
        },
        setSelection(selection: TextSelection) {
          selectionRef.current = selection;
          const view = viewRef.current;
          if (!view) return;
          view.dispatch({
            selection: clampSelection(view.state.doc.length, selection),
            annotations: externalChange.of(true),
          });
        },
        reset() {
          textRef.current = "";
          selectionRef.current = { start: 0, end: 0 };
          const view = viewRef.current;
          if (!view) return;
          view.setState(
            EditorState.create({
              doc: "",
              selection: { anchor: 0 },
              extensions: extensionsRef.current,
            }),
          );
        },
        getNativeRef() {
          return viewRef.current?.contentDOM ?? null;
        },
      }),
      [],
    );

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
    const handleClosePreview = useCallback(() => setPreview(null), []);

    return (
      <View style={props.style as StyleProp<ViewStyle>}>
        <div ref={hostRef} style={hostStyle} />
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

const hostStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: "100%",
};

const EMPTY_PAINT: ComposerPaint = { names: [], color: "", epoch: 0 };

interface EditorBindings {
  editable: Extension;
  accessibilityLabel: string;
  onKeyPressRef: { current: ((event: KeyboardEvent) => void) | undefined };
  onChangeTextRef: { current: (text: string) => void };
  onSelectionChangeRef: { current: (selection: TextSelection) => void };
  onFocusRef: { current: (() => void) | undefined };
  onBlurRef: { current: (() => void) | undefined };
  textRef: { current: string };
  selectionRef: { current: TextSelection };
}

function editorExtensions(bindings: EditorBindings): Extension {
  return [
    history(),
    EditorView.lineWrapping,
    bindings.editable,
    composerTheme,
    paintField,
    decorationsField,
    Prec.highest(
      EditorView.domEventHandlers({
        keydown(event, view) {
          if (event.isComposing || event.keyCode === 229) return false;
          if (
            event.key === "Enter" &&
            event.shiftKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey
          ) {
            event.preventDefault();
            insertBreak(view);
            return true;
          }
          bindings.onKeyPressRef.current?.(event);
          return event.key === "Enter" && event.defaultPrevented;
        },
        // The composer turns a long paste into a chip. Leave the event for that listener.
        paste() {
          return true;
        },
        focus() {
          bindings.onFocusRef.current?.();
          return false;
        },
        blur() {
          bindings.onBlurRef.current?.();
          return false;
        },
      }),
    ),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged && !update.selectionSet) return;
      const text = update.state.doc.toString();
      const main = update.state.selection.main;
      const selection = { start: main.from, end: main.to };
      bindings.textRef.current = text;
      bindings.selectionRef.current = selection;
      const external = update.transactions.every((transaction) =>
        transaction.annotation(externalChange),
      );
      if (external) return;
      if (update.docChanged) bindings.onChangeTextRef.current(text);
      bindings.onSelectionChangeRef.current(selection);
    }),
    EditorView.contentAttributes.of({
      "aria-multiline": "true",
      "aria-label": bindings.accessibilityLabel,
      "data-inline-chip-editor": "true",
      spellcheck: "false",
    }),
    EditorView.clipboardOutputFilter.of((text) => expandInlineChips(text, "copy")),
  ];
}

function insertBreak(view: EditorView): void {
  const caret = view.state.selection.main.to;
  const text = view.state.doc.toString();
  const collapsed = { start: caret, end: caret };
  const next =
    continueComposerList(text, collapsed) ??
    insertTextAtSelection({ text, selection: collapsed, insert: "\n" });
  view.dispatch({
    changes: { from: 0, to: text.length, insert: next.text },
    selection: { anchor: next.selection.start, head: next.selection.end },
    userEvent: "input",
  });
}

function currentPaint(
  names: readonly string[] | undefined,
  color: string | undefined,
  epoch: number,
): ComposerPaint {
  return { names: names ?? [], color: color ?? "", epoch };
}

function paintKey(paint: ComposerPaint): string {
  return `${paint.epoch}\n${paint.color}\n${paint.names.join("\n")}`;
}

function clampSelection(
  length: number,
  selection: TextSelection,
): { anchor: number; head: number } {
  return {
    anchor: clamp(selection.start, 0, length),
    head: clamp(selection.end, 0, length),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

class ChipWidget extends WidgetType {
  constructor(
    private readonly chip: InlineChip,
    private readonly epoch: number,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    if (!(other instanceof ChipWidget)) return false;
    return (
      other.epoch === this.epoch &&
      other.chip.id === this.chip.id &&
      other.chip.kind === this.chip.kind &&
      other.chip.label === this.chip.label &&
      other.chip.body === this.chip.body
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.dataset.inlineChip = "true";
    span.dataset.chipId = this.chip.id;
    span.dataset.chipKind = this.chip.kind;
    span.dataset.chipLabel = this.chip.label;
    span.dataset.chipBody = this.chip.body;
    span.contentEditable = "false";
    span.textContent = this.chip.label;
    span.setAttribute("role", "button");
    applyInlineChipDomStyle(span);
    span.style.verticalAlign = "baseline";
    span.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      chipPressByView.get(view)?.(this.chip, span.getBoundingClientRect());
    });
    return span;
  }
}

function buildDecorations(state: EditorState): ComposerDecorations {
  const paint = state.field(paintField, false) ?? EMPTY_PAINT;
  const theme = readTheme();
  const text = state.doc.toString();
  const visual: Range<Decoration>[] = [];
  const backticks: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  let offset = 0;
  for (const part of parseInlineParts(text)) {
    if (part.kind === "chip") {
      const length = serializeInlineChip(part.chip).length;
      const widget = Decoration.replace({
        widget: new ChipWidget(part.chip, paint.epoch),
      });
      visual.push(widget.range(offset, offset + length));
      atomic.push(widget.range(offset, offset + length));
      offset += length;
      continue;
    }
    paintTextPart(part.text, offset, paint, theme, visual, backticks);
    offset += part.text.length;
  }
  return {
    visual: Decoration.set(visual, true),
    backticks: Decoration.set(backticks, true),
    atomic: Decoration.set(atomic, true),
  };
}

function paintTextPart(
  text: string,
  base: number,
  paint: ComposerPaint,
  theme: Theme | null,
  visual: Range<Decoration>[],
  backticks: Range<Decoration>[],
): void {
  const skills = findSkillHighlightRanges(text, paint.names);
  for (const range of skills) {
    if (range.end <= range.start) continue;
    const mark = Decoration.mark({
      attributes: {
        "data-skill-mention": "true",
        ...(paint.color ? { style: `color: ${paint.color}` } : {}),
      },
    });
    visual.push(mark.range(base + range.start, base + range.end));
  }
  const codeStyle = theme ? inlineCodeStyle(theme) : null;
  if (!codeStyle) return;
  for (const code of findComposerInlineCode(text)) {
    if (overlaps(code, skills)) continue;
    const mark = Decoration.mark({
      attributes: { "data-composer-code": "true", style: codeStyle },
    });
    visual.push(mark.range(base + code.start, base + code.end));
    const slice = text.slice(code.start, code.end);
    const open = /^`+/.exec(slice)?.[0].length ?? 0;
    const close = /`+$/.exec(slice)?.[0].length ?? 0;
    const fade = Decoration.mark({ attributes: { style: "color: transparent" } });
    if (open > 0) backticks.push(fade.range(base + code.start, base + code.start + open));
    if (close > 0 && code.end - close > code.start + open) {
      backticks.push(fade.range(base + code.end - close, base + code.end));
    }
  }
}

function overlaps(
  range: { start: number; end: number },
  others: readonly { start: number; end: number }[],
): boolean {
  return others.some((other) => range.start < other.end && range.end > other.start);
}

function inlineCodeStyle(theme: Theme): string | null {
  const background = theme.colors.surface2;
  const radius = theme.borderRadius.base;
  if (!background || radius == null) return null;
  return `background-color: ${background}; border-radius: ${radius}px`;
}

function readTheme(): Theme | null {
  const theme = getUnistylesAppTheme();
  if (theme.colors == null) return null;
  return theme;
}

/**
 * CodeMirror's base theme is a monospace file editor. These overrides put the
 * composer font, the line box, and the text rail back where the textarea sits.
 */
const composerTheme = EditorView.theme({
  "&.cm-editor": {
    width: "100%",
    height: "100%",
    backgroundColor: "transparent",
    color: "inherit",
    fontFamily: "inherit",
    fontSize: "inherit",
    fontWeight: "inherit",
    fontStyle: "inherit",
    lineHeight: "inherit",
    letterSpacing: "inherit",
    outline: "none",
  },
  "&.cm-editor.cm-focused": {
    outline: "none",
  },
  "&.cm-editor .cm-scroller": {
    overflow: "auto",
    fontFamily: "inherit",
    lineHeight: "inherit",
  },
  "&.cm-editor .cm-content": {
    fontFamily: "inherit",
    fontSize: "inherit",
    lineHeight: "inherit",
    color: "inherit",
    caretColor: "currentColor",
    padding: "0",
    minHeight: "100%",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  "&.cm-editor .cm-line": {
    padding: "0",
    fontFamily: "inherit",
    lineHeight: "inherit",
  },
  "&.cm-editor .cm-cursor, &.cm-editor .cm-dropCursor": {
    borderLeftColor: "currentColor",
  },
});
