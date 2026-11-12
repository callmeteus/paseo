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
}) {
  return (
    <I18nextProvider i18n={i18n}>
      <InlineChipEditor
        ref={props.inputRef}
        initialText={chipText}
        initialSelection={chipSelection}
        undoBaseline={props.undoBaseline}
        editable
        accessibilityLabel="Message"
        onChangeText={recordChange}
        onSelectionChange={ignoreSelection}
      />
    </I18nextProvider>
  );
}

function mountEditor(undoBaseline: InlineChipEditSnapshot | null): MountedEditor {
  const inputRef = React.createRef<EditingTextInputHandle>();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (baseline: InlineChipEditSnapshot | null) => {
    root.render(<EditorHarness undoBaseline={baseline} inputRef={inputRef} />);
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

describe("inline chip editor", () => {
  it("keeps the caret after a chip across focus so backspace deletes it", () => {
    const mountedEditor = mountEditor(null);
    act(() => {
      mountedEditor.handle.blur();
      mountedEditor.handle.focus();
    });
    const selection = document.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!range) throw new Error("Editor has no caret");
    expect(range.startContainer).toBe(mountedEditor.editor);
    expect(range.startOffset).toBe(1);

    act(() => {
      mountedEditor.editor.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }),
      );
    });

    expect(changes).toEqual([""]);
    expect(mountedEditor.editor.querySelector("[data-inline-chip]")).toBeNull();
  });

  it("undoes a paste back to the text that was there before the chip", () => {
    const mountedEditor = mountEditor(helloBaseline);
    const chipNode = mountedEditor.editor.querySelector("[data-inline-chip]");
    if (!(chipNode instanceof HTMLElement)) throw new Error("Paste chip is missing");
    expect(chipNode.textContent).toBe("[Colado ~3 linhas]");
    expect(chipNode.getAttribute("data-chip-body")).toBe('say "hi"\nsecond\nthird');

    act(() => {
      document.execCommand("undo");
    });

    expect(changes).toEqual(["hello"]);
    expect(mountedEditor.handle.getText()).toBe("hello");
  });

  it("undoes a paste after the editor re-renders", () => {
    const mountedEditor = mountEditor(helloBaseline);
    act(() => mountedEditor.render(null));

    act(() => {
      document.execCommand("undo");
    });

    expect(changes).toEqual(["hello"]);
    expect(mountedEditor.handle.getText()).toBe("hello");
  });

  it("undoes a paste into an empty composer", () => {
    const mountedEditor = mountEditor(emptyBaseline);

    act(() => {
      document.execCommand("undo");
    });

    expect(changes).toEqual([""]);
    expect(mountedEditor.handle.getText()).toBe("");
  });
});
