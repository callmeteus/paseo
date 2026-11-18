import type { StyleProp, TextStyle } from "react-native";
import type { TextSelection } from "@getpaseo/protocol/inline-chip";

export interface InlineChipEditSnapshot {
  text: string;
  selection: TextSelection;
}

export interface InlineChipEditorProps {
  initialText: string;
  initialSelection: TextSelection;
  /**
   * Text that was on screen before this editor mounted with a chip. The first
   * history entry is that text, so undo can take the paste back.
   */
  undoBaseline?: InlineChipEditSnapshot | null;
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
