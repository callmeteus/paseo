export interface ComposerListMarker {
  start: number;
  end: number;
  kind: "bullet" | "ordered";
}

export interface ComposerMirrorPiece {
  start: number;
  text: string;
  kind: "plain" | "skill" | "bullet" | "ordered" | "code";
}

export interface ComposerInlineCodeSpan {
  start: number;
  end: number;
}

const LIST_MARKER = /^( *)([-*+]|\d{1,9}\.) /;

/**
 * List markers the composer draws in place of the source glyph.
 * The range is only the marker token, so the following space stays a space and
 * the line keeps the same width as the textarea under it.
 */
export function findComposerListMarkers(text: string): ComposerListMarker[] {
  const markers: ComposerListMarker[] = [];
  const lines = text.split("\n");
  let offset = 0;
  for (const line of lines) {
    const match = LIST_MARKER.exec(line);
    if (match?.[2]) {
      const indent = match[1] ?? "";
      const token = match[2];
      const start = offset + indent.length;
      markers.push({
        start,
        end: start + token.length,
        kind: token === "-" || token === "*" || token === "+" ? "bullet" : "ordered",
      });
    }
    offset += line.length + 1;
  }
  return markers;
}

export function hasComposerListMarker(text: string): boolean {
  const lines = text.split("\n");
  for (const line of lines) {
    if (LIST_MARKER.test(line)) return true;
  }
  return false;
}

/**
 * Closed inline code on a single line. An unclosed backtick stays plain text,
 * and a fence line is not inline code.
 */
export function findComposerInlineCode(text: string): ComposerInlineCodeSpan[] {
  const spans: ComposerInlineCodeSpan[] = [];
  let open: OpenFence | null = null;
  let offset = 0;
  for (const line of text.split("\n")) {
    const marker = fenceToken(line);
    if (marker) {
      open = nextFence(open, line);
    } else if (!open) {
      collectInlineCode(line, offset, spans);
    }
    offset += line.length + 1;
  }
  return spans;
}

export function hasComposerInlineCode(text: string): boolean {
  return findComposerInlineCode(text).length > 0;
}

interface ComposerCaret {
  start: number;
  end: number;
}

export interface ComposerListContinuation {
  text: string;
  selection: ComposerCaret;
}

/**
 * Enter submits only where the composer offers Enter-to-send (desktop web).
 * Everywhere else it breaks the line, and a break inside a list opens the next
 * item, so compact web must not be treated as a submit.
 */
export function breaksComposerLineOnEnter(input: {
  shiftKey: boolean;
  submitOnEnter: boolean;
}): boolean {
  return input.shiftKey || !input.submitOnEnter;
}

/**
 * Opens the next item of the list the caret is in.
 * An empty item is removed and the line stays blank, so pressing the break
 * again ends the list. Returns null when this break should be a plain newline.
 */
export function continueComposerList(
  text: string,
  selection: ComposerCaret,
): ComposerListContinuation | null {
  if (selection.start !== selection.end) return null;
  const caret = clamp(selection.start, 0, text.length);
  const line = lineAt(text, caret);
  const marker = matchListMarker(line.text);
  if (!marker || isInsideFence(text, line.start)) return null;
  if (marker.content.trim().length === 0) {
    const next = text.slice(0, line.start) + text.slice(line.end);
    return { text: next, selection: { start: line.start, end: line.start } };
  }

  const split = Math.max(caret, line.start + marker.prefixLength);
  const token = marker.kind === "ordered" ? `${marker.number + 1}.` : marker.token;
  const insertion = `\n${marker.indent}${token} `;
  const nextCaret = split + insertion.length;
  let next = text.slice(0, split) + insertion + text.slice(split);
  if (marker.kind === "ordered") {
    next = renumberOrderedTail(next, nextCaret, marker.indent, marker.number + 2);
  }
  return { text: next, selection: { start: nextCaret, end: nextCaret } };
}

/**
 * Indents or outdents the list lines the caret is on.
 * Returns null when any touched line is not a list item, so Tab keeps its
 * other job. A list item already at the margin still returns the same text:
 * the key belongs to the list and must not leave the field.
 */
export function indentComposerList(
  text: string,
  selection: ComposerCaret,
  direction: "in" | "out",
): ComposerListContinuation | null {
  const lines = textLines(text);
  const touched = touchedLineIndexes(lines, text.length, selection);
  const edits: ListIndentEdit[] = [];
  for (let index = touched.first; index <= touched.last; index += 1) {
    const line = lines[index];
    if (!line || isInsideFence(text, line.start)) return null;
    const edit = listIndentEdit(line, direction);
    if (!edit) return null;
    edits.push(edit);
  }
  return applyListIndent(text, selection, edits);
}

/**
 * Splits composer text into the pieces the mirror paints.
 * A list marker wins over a skill token that starts in the same place, so the
 * marker width stays equal to the characters in the textarea.
 */
export function composeComposerMirrorPieces(
  text: string,
  skillRanges: readonly { start: number; end: number }[],
): ComposerMirrorPiece[] {
  const spans: ComposerMirrorPiece[] = [
    ...findComposerListMarkers(text).map((marker) => ({
      start: marker.start,
      text: text.slice(marker.start, marker.end),
      kind: marker.kind,
    })),
    ...findComposerInlineCode(text).map((span) => ({
      start: span.start,
      text: text.slice(span.start, span.end),
      kind: "code" as const,
    })),
    ...skillRanges.map((range) => ({
      start: range.start,
      text: text.slice(range.start, range.end),
      kind: "skill" as const,
    })),
  ].sort((left, right) => left.start - right.start);

  const pieces: ComposerMirrorPiece[] = [];
  let cursor = 0;
  for (const span of spans) {
    const end = span.start + span.text.length;
    const start = Math.max(span.start, cursor);
    if (span.text.length === 0 || end <= cursor) continue;
    if (start > cursor) {
      pieces.push({ start: cursor, text: text.slice(cursor, start), kind: "plain" });
    }
    pieces.push(
      start === span.start ? span : { start, text: text.slice(start, end), kind: span.kind },
    );
    cursor = end;
  }
  if (cursor < text.length) {
    pieces.push({ start: cursor, text: text.slice(cursor), kind: "plain" });
  }
  return pieces;
}

interface BulletMarkerMatch {
  indent: string;
  token: string;
  prefixLength: number;
  content: string;
  kind: "bullet";
}

interface OrderedMarkerMatch {
  indent: string;
  token: string;
  prefixLength: number;
  content: string;
  kind: "ordered";
  number: number;
}

type ListMarkerMatch = BulletMarkerMatch | OrderedMarkerMatch;

function matchListMarker(line: string): ListMarkerMatch | null {
  const match = LIST_MARKER.exec(line);
  if (!match) return null;
  const token = match[2];
  if (!token) return null;
  const indent = match[1] ?? "";
  const prefixLength = indent.length + token.length + 1;
  const content = line.slice(prefixLength);
  if (!token.endsWith(".")) {
    return { indent, token, prefixLength, content, kind: "bullet" };
  }
  return {
    indent,
    token,
    prefixLength,
    content,
    kind: "ordered",
    number: Number(token.slice(0, -1)),
  };
}

interface TextLine {
  start: number;
  end: number;
  text: string;
}

function lineAt(text: string, caret: number): TextLine {
  const start = caret === 0 ? 0 : text.lastIndexOf("\n", caret - 1) + 1;
  const breakAt = text.indexOf("\n", start);
  const end = breakAt === -1 ? text.length : breakAt;
  return { start, end, text: text.slice(start, end) };
}

function renumberOrderedTail(
  text: string,
  caret: number,
  indent: string,
  nextNumber: number,
): string {
  const lines = text.split("\n");
  const caretLine = lineIndexAt(lines, caret);
  let number = nextNumber;
  for (let index = caretLine + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) break;
    const marker = matchListMarker(line);
    if (!marker) break;
    const nested = marker.indent.length > indent.length && marker.indent.startsWith(indent);
    if (nested) continue;
    if (marker.indent !== indent || marker.kind !== "ordered") break;
    lines[index] = `${marker.indent}${number}. ${marker.content}`;
    number += 1;
  }
  return lines.join("\n");
}

function lineIndexAt(lines: readonly string[], caret: number): number {
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineEnd = offset + line.length;
    if (caret <= lineEnd) return index;
    offset = lineEnd + 1;
  }
  return Math.max(0, lines.length - 1);
}

interface OpenFence {
  char: "`" | "~";
  length: number;
}

function isInsideFence(text: string, lineStart: number): boolean {
  let open: OpenFence | null = null;
  let offset = 0;
  for (const line of text.split("\n")) {
    if (offset >= lineStart) return open !== null;
    open = nextFence(open, line);
    offset += line.length + 1;
  }
  return false;
}

function nextFence(open: OpenFence | null, line: string): OpenFence | null {
  const marker = fenceToken(line);
  if (!marker) return open;
  const closes =
    open !== null && marker.char === open.char && marker.length >= open.length && marker.closes;
  if (closes) return null;
  if (open === null) return { char: marker.char, length: marker.length };
  return open;
}

function fenceToken(line: string): { char: "`" | "~"; length: number; closes: boolean } | null {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const token = match[2];
  if (!token) return null;
  const char = token.startsWith("`") ? "`" : "~";
  const rest = match[3] ?? "";
  return { char, length: token.length, closes: rest.trim().length === 0 };
}

const INLINE_CODE = /(`+)([^\n]*?)\1/g;

function collectInlineCode(line: string, offset: number, spans: ComposerInlineCodeSpan[]): void {
  INLINE_CODE.lastIndex = 0;
  let match = INLINE_CODE.exec(line);
  while (match) {
    const body = match[2] ?? "";
    if (body.length > 0) {
      spans.push({ start: offset + match.index, end: offset + match.index + match[0].length });
    }
    match = INLINE_CODE.exec(line);
  }
}

interface ListIndentEdit {
  start: number;
  added: number;
  removed: number;
  text: string;
}

function textLines(text: string): TextLine[] {
  const lines: TextLine[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    lines.push({ start: offset, end: offset + line.length, text: line });
    offset += line.length + 1;
  }
  return lines;
}

function touchedLineIndexes(
  lines: readonly TextLine[],
  textLength: number,
  selection: ComposerCaret,
): { first: number; last: number } {
  const from = clamp(Math.min(selection.start, selection.end), 0, textLength);
  const to = clamp(Math.max(selection.start, selection.end), 0, textLength);
  const anchor = to > from ? to - 1 : to;
  const raw = lines.map((line) => line.text);
  return { first: lineIndexAt(raw, from), last: lineIndexAt(raw, anchor) };
}

function listIndentEdit(line: TextLine, direction: "in" | "out"): ListIndentEdit | null {
  const marker = matchListMarker(line.text);
  if (!marker) return null;
  const step = marker.prefixLength - marker.indent.length;
  const removed = direction === "out" ? Math.min(marker.indent.length, step) : 0;
  const added = direction === "in" ? step : 0;
  return {
    start: line.start,
    added,
    removed,
    text: `${" ".repeat(added)}${line.text.slice(removed)}`,
  };
}

function applyListIndent(
  text: string,
  selection: ComposerCaret,
  edits: readonly ListIndentEdit[],
): ComposerListContinuation {
  let next = "";
  let cursor = 0;
  for (const edit of edits) {
    next += text.slice(cursor, edit.start);
    next += edit.text;
    cursor = edit.start + edit.removed + (edit.text.length - edit.added);
  }
  next += text.slice(cursor);
  return {
    text: next,
    selection: {
      start: mapIndentIndex(selection.start, edits),
      end: mapIndentIndex(selection.end, edits),
    },
  };
}

function mapIndentIndex(index: number, edits: readonly ListIndentEdit[]): number {
  let shift = 0;
  for (const edit of edits) {
    if (index < edit.start) break;
    if (index < edit.start + edit.removed) return edit.start + shift;
    shift += edit.added - edit.removed;
  }
  return index + shift;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
