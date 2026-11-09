/** Text plus the caret/selection the editor should hold after applying it. */
export interface TextReplacement {
  text: string;
  selection: { start: number; end: number };
}

export function collapsedSelection(position: number): { start: number; end: number } {
  return { start: position, end: position };
}
