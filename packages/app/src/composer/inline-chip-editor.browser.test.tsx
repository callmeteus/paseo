import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import { serializeInlineChip, type InlineChip } from "@getpaseo/protocol/inline-chip";
import type { EditingTextInputHandle } from "@/components/ui/text-input/types";
import { i18n } from "@/i18n/i18next";
import { InlineChipEditor, type InlineChipEditSnapshot } from "./inline-chip-editor";

const chip: InlineChip = {
  id: "paste:1",
  kind: "paste",
  label: "[Colado ~3 linhas]",
  body: 'say "hi"\nsecond\nthird',
};
const chipText = serializeInlineChip(chip);
const chipSelection = { start: chipText.length, end: chipText.length };
const helloBaseline: InlineChipEditSnapshot = { text: "hello", selection: { start: 5, end: 5 } };
const emptyBaseline: InlineChipEditSnapshot = { text: "", selection: { start: 0, end: 0 } };

const changes: string[] = [];

function recordChange(text: string): void {
  changes.push(text);
}

function ignoreSelection(): void {}

interface MountedEditor {
  root: Root;
  container: HTMLDivElement;
  editor: HTMLElement;
  handle: EditingTextInputHandle;
  render: (undoBaseline: InlineChipEditSnapshot | null) => void;
}

const mounted: MountedEditor[] = [];

function EditorHarness(props: {
  undoBaseline: InlineChipEditSnapshot | null;
  inputRef: React.Ref<EditingTextInputHandle>;
  initialText?: string;
  initialSelection?: { start: number; end: number };
}) {
  return (
    <I18nextProvider i18n={i18n}>
      <InlineChipEditor
        ref={props.inputRef}
        initialText={props.initialText ?? chipText}
        initialSelection={props.initialSelection ?? chipSelection}
        undoBaseline={props.undoBaseline}
        editable
        accessibilityLabel="Message"
        onChangeText={recordChange}
        onSelectionChange={ignoreSelection}
      />
    </I18nextProvider>
  );
}

function mountEditor(
  undoBaseline: InlineChipEditSnapshot | null,
  options?: { initialText: string; initialSelection: { start: number; end: number } },
): MountedEditor {
  const inputRef = React.createRef<EditingTextInputHandle>();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (baseline: InlineChipEditSnapshot | null) => {
    root.render(
      <EditorHarness
        undoBaseline={baseline}
        inputRef={inputRef}
        initialText={options?.initialText}
        initialSelection={options?.initialSelection}
      />,
    );
  };
  act(() => render(undoBaseline));
  const editor = container.querySelector("[data-inline-chip-editor]");
  const handle = inputRef.current;
  if (!(editor instanceof HTMLElement) || !handle) {
    throw new Error("Inline chip editor did not mount");
  }
  const mountedEditor = { root, container, editor, handle, render };
  mounted.push(mountedEditor);
  return mountedEditor;
}

afterEach(() => {
  changes.length = 0;
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function pressKey(editor: HTMLElement, key: string, modifiers?: { shiftKey?: boolean }): void {
  editor.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      shiftKey: modifiers?.shiftKey,
    }),
  );
}

function undo(editor: HTMLElement): void {
  editor.dispatchEvent(
    new InputEvent("beforeinput", {
      inputType: "historyUndo",
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("inline chip editor", () => {
  it("keeps the caret after a chip across focus so backspace deletes it", () => {
    const mountedEditor = mountEditor(null);
    act(() => {
      mountedEditor.handle.blur();
      mountedEditor.handle.focus();
    });

    act(() => {
      pressKey(mountedEditor.editor, "Backspace");
    });

    expect(changes).toEqual([""]);
    expect(mountedEditor.handle.getText()).toBe("");
    expect(mountedEditor.editor.querySelector("[data-inline-chip]")).toBeNull();
  });

  it("undoes deleting a pasted chip with backspace", () => {
    const mountedEditor = mountEditor(null);
    act(() => {
      pressKey(mountedEditor.editor, "Backspace");
    });
    expect(mountedEditor.handle.getText()).toBe("");
    expect(mountedEditor.editor.querySelector("[data-inline-chip]")).toBeNull();

    act(() => {
      undo(mountedEditor.editor);
    });

    expect(mountedEditor.handle.getText()).toBe(chipText);
    expect(mountedEditor.editor.querySelector("[data-inline-chip]")).not.toBeNull();
  });

  it("undoes a paste back to the text that was there before the chip", () => {
    const mountedEditor = mountEditor(helloBaseline);
    const chipNode = mountedEditor.editor.querySelector("[data-inline-chip]");
    if (!(chipNode instanceof HTMLElement)) throw new Error("Paste chip is missing");
    expect(chipNode.textContent).toBe("[Colado ~3 linhas]");
    expect(chipNode.getAttribute("data-chip-body")).toBe('say "hi"\nsecond\nthird');

    act(() => {
      undo(mountedEditor.editor);
    });

    expect(changes).toEqual(["hello"]);
    expect(mountedEditor.handle.getText()).toBe("hello");
  });

  it("undoes a paste after the editor re-renders", () => {
    const mountedEditor = mountEditor(helloBaseline);
    act(() => mountedEditor.render(null));

    act(() => {
      undo(mountedEditor.editor);
    });

    expect(changes).toEqual(["hello"]);
    expect(mountedEditor.handle.getText()).toBe("hello");
  });

  it("undoes a paste into an empty composer", () => {
    const mountedEditor = mountEditor(emptyBaseline);

    act(() => {
      undo(mountedEditor.editor);
    });

    expect(changes).toEqual([""]);
    expect(mountedEditor.handle.getText()).toBe("");
  });

  it("deletes one character on the line after a paste chip", () => {
    const typed = `${chipText}\nhello`;
    const mountedEditor = mountEditor(null, {
      initialText: typed,
      initialSelection: { start: typed.length, end: typed.length },
    });

    act(() => {
      pressKey(mountedEditor.editor, "Backspace");
    });

    expect(mountedEditor.handle.getText()).toBe(`${chipText}\nhell`);
    expect(mountedEditor.editor.querySelector("[data-inline-chip]")).not.toBeNull();
  });

  it("keeps the list item text on Shift+Enter even with a stale wide selection", () => {
    const listText = `${chipText}\n- Transporte é obrigatório`;
    const mountedEditor = mountEditor(null, {
      initialText: listText,
      initialSelection: { start: listText.length, end: listText.length },
    });
    const editor = mountedEditor.editor;

    // A selection left over from a paste or a re-render spans the visible item.
    // The line break must collapse to the caret, not replace that selection.
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    let target: Text | null = null;
    while (node) {
      if (node.textContent?.includes("Transporte")) {
        target = node as Text;
        break;
      }
      node = walker.nextNode();
    }
    if (!target) throw new Error("List item text node is missing");
    const range = document.createRange();
    range.selectNodeContents(target);
    const selection = document.getSelection();
    if (!selection) throw new Error("Document has no selection");
    selection.removeAllRanges();
    selection.addRange(range);

    act(() => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const result = mountedEditor.handle.getText();
    expect(result).toContain("- Transporte é obrigatório");
    expect(result).toContain(chipText);
    expect(result).toContain("\n- ");
  });
});
