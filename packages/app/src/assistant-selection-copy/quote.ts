/** Formats selected chat text as a Markdown blockquote for the composer. */
export function formatSelectionQuote(selection: string): string {
  return selection
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

/** Appends a quoted selection to the draft, leaving a blank line to type the question. */
export function appendSelectionToDraftText(current: string, selection: string): string {
  const quoted = formatSelectionQuote(selection);
  return current.trim().length > 0 ? `${current}\n\n${quoted}\n\n` : `${quoted}\n\n`;
}
