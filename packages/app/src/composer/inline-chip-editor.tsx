import { forwardRef, useImperativeHandle } from "react";
import type { EditingTextInputHandle } from "@/components/ui/text-input/types";
import { type InlineChipEditSnapshot, type InlineChipEditorProps } from "./inline-chip-editor-api";

export type { InlineChipEditSnapshot, InlineChipEditorProps };

/**
 * Chips are drawn by the web editor. Native keeps the textarea and never mounts this.
 */
export const InlineChipEditor = forwardRef<EditingTextInputHandle, InlineChipEditorProps>(
  function InlineChipEditor(props, ref) {
    useImperativeHandle(
      ref,
      () => ({
        focus() {},
        blur() {},
        isFocused() {
          return false;
        },
        getText() {
          return props.initialText;
        },
        replaceText() {},
        setSelection() {},
        reset() {},
        getNativeRef() {
          return null;
        },
      }),
      [props.initialText],
    );
    return null;
  },
);
