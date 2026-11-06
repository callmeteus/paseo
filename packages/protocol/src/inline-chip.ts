/**
 * Inline paste and chat-mention chips.
 *
 * A chip is one atom in the composer and in the sent message. The message text
 * stays a string, which is the shape the timeline already stores. The atom is a
 * JSON record between two control characters that `JSON.stringify` escapes if
 * they appear inside the pasted body, so a paste cannot close its own marker.
 *
 * OpenCode collapses a paste at 3 lines or 150 characters and labels it
 * `[Pasted ~N lines]`. `shouldChipPaste` uses those same thresholds. A shorter
 * paste stays ordinary text.
 */

export const PASTE_CHIP_MIN_LINES = 3;
export const PASTE_CHIP_MIN_CHARS = 150;

const MARKER_START = "\u001E";
const MARKER_END = "\u001F";

export type InlineChipKind = "paste" | "mention";

export interface InlineChip {
  id: string;
  kind: InlineChipKind;
  /** What the atom shows. Paste labels include the OpenCode brackets. */
  label: string;
  /** Full pasted text, or the mentioned chat's history. Empty while a mention is still loading. */
  body: string;
}

export type InlinePart = { kind: "text"; text: string } | { kind: "chip"; chip: InlineChip };

export interface TextSelection {
  start: number;
  end: number;
}

interface StoredChip {
  v: 1;
  id: string;
  kind: InlineChipKind;
  label: string;
  body: string;
}

/**
 * How many lines a paste occupies. A trailing newline counts, matching
 * `split("\n")`, so three visual lines become a chip even when the last is empty.
 */
export function countPasteLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r\n|\n|\r/).length;
}

/**
 * Whether this paste should become a chip instead of landing as text.
 * Blank pastes stay text: there is nothing to disclose.
 */
export function shouldChipPaste(text: string): boolean {
  if (text.trim().length === 0) return false;
  return countPasteLines(text) >= PASTE_CHIP_MIN_LINES || text.length >= PASTE_CHIP_MIN_CHARS;
}

/**
 * The OpenCode label shape: brackets, a tilde, then the count.
 * `pastedWord` and `lineWord` come from the composer locale (`Colado` / `linha`).
 */
export function formatPasteChipLabel(input: {
  count: number;
  pastedWord: string;
  lineWord: string;
}): string {
  return `[${input.pastedWord} ~${input.count} ${input.lineWord}]`;
}

/** Chat title, then workspace name, then the agent id. Never empty. */
export function mentionChipLabel(input: {
  title: string | null;
  workspaceName?: string | null;
  agentId: string;
}): string {
  const title = input.title?.trim();
  if (title) return title;
  const workspaceName = input.workspaceName?.trim();
  if (workspaceName) return workspaceName;
  return input.agentId;
}

/** Encode one chip so it can sit in the middle of a plain message string. */
export function serializeInlineChip(chip: InlineChip): string {
  const stored: StoredChip = {
    v: 1,
    id: chip.id,
    kind: chip.kind,
    label: chip.label,
    body: chip.body,
  };
  return `${MARKER_START}${JSON.stringify(stored)}${MARKER_END}`;
}

/** Split a message into text runs and chips, in order. Markers that are not chips stay text. */
export function parseInlineParts(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(MARKER_START, cursor);
    if (start < 0) {
      pushText(parts, text.slice(cursor));
      break;
    }
    if (start > cursor) pushText(parts, text.slice(cursor, start));
    const end = text.indexOf(MARKER_END, start + MARKER_START.length);
    if (end < 0) {
      pushText(parts, text.slice(start));
      break;
    }
    const chip = parseStoredChip(text.slice(start + MARKER_START.length, end));
    if (!chip) {
      pushText(parts, MARKER_START);
      cursor = start + MARKER_START.length;
      continue;
    }
    parts.push({ kind: "chip", chip });
    cursor = end + MARKER_END.length;
  }
  return parts;
}

/** True when the message contains at least one chip. */
export function hasInlineChip(text: string): boolean {
  return parseInlineParts(text).some((part) => part.kind === "chip");
}

/** Ids of every chip, in order. The composer uses these to hide the matching tray pill. */
export function inlineChipIds(text: string): string[] {
  const ids: string[] = [];
  for (const part of parseInlineParts(text)) {
    if (part.kind === "chip") ids.push(part.chip.id);
  }
  return ids;
}

/** Stable subscription key: changes when a chip is added or removed, not when its body loads. */
export function inlineChipIdKey(text: string): string {
  return inlineChipIds(text).join("\n");
}

/** Whether this composer text already shows the attachment as an inline chip. */
export function textContainsInlineChipId(text: string, id: string): boolean {
  return inlineChipIds(text).includes(id);
}

/**
 * A sent chat-history attachment is the same content as a mention chip when the
 * bodies match. The history row then draws the chip in the sentence and skips
 * the pill that used to sit above the message.
 */
export function mentionChipCoversAttachment(text: string, attachmentText: string): boolean {
  if (attachmentText.length === 0) return false;
  return parseInlineParts(text).some(
    (part) =>
      part.kind === "chip" && part.chip.kind === "mention" && part.chip.body === attachmentText,
  );
}

/** The sentence as the user sees it: chip labels in place of the stored records. */
export function inlineChipDisplayText(text: string): string {
  return parseInlineParts(text)
    .map((part) => (part.kind === "text" ? part.text : part.chip.label))
    .join("");
}

/**
 * Same indexes as `text`, with each chip's stored record replaced by spaces.
 * Autocomplete looks at this so an `@` inside a paste does not open the picker,
 * while the caret index in the real string still lines up.
 */
export function maskInlineChips(text: string): string {
  return parseInlineParts(text)
    .map((part) => {
      if (part.kind === "text") return part.text;
      return " ".repeat(serializeInlineChip(part.chip).length);
    })
    .join("");
}

export type InlineChipExpansion = "prompt" | "copy";

/**
 * What a consumer other than the chip UI should read.
 *
 * `prompt`: a paste becomes its body, in place. A mention becomes its label,
 * because the chat-history attachment is already sent beside the message.
 * `copy`: both become the body when it has loaded, so the clipboard has the
 * text the user actually attached.
 */
export function expandInlineChips(text: string, mode: InlineChipExpansion): string {
  return parseInlineParts(text)
    .map((part) => {
      if (part.kind === "text") return part.text;
      if (mode === "copy") {
        return part.chip.body.length > 0 ? part.chip.body : part.chip.label;
      }
      if (part.chip.kind === "paste") return part.chip.body;
      return part.chip.label;
    })
    .join("");
}

/**
 * The wire text stays the chip string so history can draw the atom. The model
 * receives `promptText`, with pastes expanded. `submittedPromptText` is set
 * only when a chip is present, so an ordinary message keeps the daemon's
 * existing timeline text.
 */
export function prepareInlineChipSubmission(text: string): {
  promptText: string;
  submittedPromptText?: string;
} {
  if (!hasInlineChip(text)) return { promptText: text };
  return {
    promptText: expandInlineChips(text, "prompt"),
    submittedPromptText: text,
  };
}

/** Replace the selected range with plain text and put the caret after it. */
export function insertTextAtSelection(input: {
  text: string;
  selection: TextSelection;
  insert: string;
}): { text: string; selection: TextSelection } {
  const start = clamp(input.selection.start, 0, input.text.length);
  const end = clamp(input.selection.end, start, input.text.length);
  const text = input.text.slice(0, start) + input.insert + input.text.slice(end);
  const cursor = start + input.insert.length;
  return { text, selection: { start: cursor, end: cursor } };
}

/** Insert a chip at the caret, replacing any selected range. The caret sits just after the atom. */
export function insertInlineChip(input: {
  text: string;
  selection: TextSelection;
  chip: InlineChip;
}): { text: string; selection: TextSelection } {
  return insertTextAtSelection({
    text: input.text,
    selection: input.selection,
    insert: serializeInlineChip(input.chip),
  });
}

/** Fill in a mention once its history has loaded, without moving the surrounding sentence. */
export function updateInlineChipBody(text: string, id: string, body: string): string {
  const parts = parseInlineParts(text);
  let changed = false;
  const next = parts.map((part) => {
    if (part.kind !== "chip" || part.chip.id !== id || part.chip.body === body) return part;
    changed = true;
    return { kind: "chip" as const, chip: { ...part.chip, body } };
  });
  if (!changed) return text;
  return serializeInlineParts(next);
}

/**
 * Backspace or Delete against a chip removes the whole atom.
 * Returns null when the caret is not touching a chip, so the caller can let the key through.
 */
export function removeAdjacentInlineChip(input: {
  text: string;
  selection: TextSelection;
  direction: "backward" | "forward";
}): { text: string; selection: TextSelection } | null {
  if (input.selection.start !== input.selection.end) return null;
  const caret = clamp(input.selection.start, 0, input.text.length);
  let offset = 0;
  for (const part of parseInlineParts(input.text)) {
    const length = partLength(part);
    const end = offset + length;
    if (part.kind === "chip") {
      const inside = caret > offset && caret < end;
      const before = input.direction === "backward" && caret === end;
      const after = input.direction === "forward" && caret === offset;
      if (inside || before || after) {
        const text = input.text.slice(0, offset) + input.text.slice(end);
        return { text, selection: { start: offset, end: offset } };
      }
    }
    offset = end;
  }
  return null;
}

/**
 * Where a raw caret (indexes into the stored string) sits in the visible sentence.
 * A caret inside a chip's record snaps to the end of its label.
 */
export function mapRawOffsetToDisplay(text: string, rawOffset: number): number {
  const target = clamp(rawOffset, 0, text.length);
  let raw = 0;
  let display = 0;
  for (const part of parseInlineParts(text)) {
    if (part.kind === "text") {
      if (raw + part.text.length >= target) return display + (target - raw);
      raw += part.text.length;
      display += part.text.length;
      continue;
    }
    const serializedLength = serializeInlineChip(part.chip).length;
    if (raw + serializedLength >= target) {
      return target === raw ? display : display + part.chip.label.length;
    }
    raw += serializedLength;
    display += part.chip.label.length;
  }
  return display;
}

/**
 * Keep the caret on the same visible character after a chip body grows or shrinks.
 * The stored record changes length; the label does not, so the caret stays put.
 */
export function preserveDisplaySelection(
  previous: string,
  next: string,
  selection: TextSelection,
): TextSelection {
  return {
    start: mapDisplayOffsetToRaw(next, mapRawOffsetToDisplay(previous, selection.start)),
    end: mapDisplayOffsetToRaw(next, mapRawOffsetToDisplay(previous, selection.end)),
  };
}

/** Inverse of `mapRawOffsetToDisplay`. A caret inside a label snaps to the end of the stored record. */
export function mapDisplayOffsetToRaw(text: string, displayOffset: number): number {
  const target = Math.max(0, displayOffset);
  let raw = 0;
  let display = 0;
  for (const part of parseInlineParts(text)) {
    if (part.kind === "text") {
      if (display + part.text.length >= target) return raw + (target - display);
      raw += part.text.length;
      display += part.text.length;
      continue;
    }
    const labelLength = part.chip.label.length;
    const serializedLength = serializeInlineChip(part.chip).length;
    if (display + labelLength >= target) {
      return target === display ? raw : raw + serializedLength;
    }
    raw += serializedLength;
    display += labelLength;
  }
  return raw;
}

function serializeInlineParts(parts: readonly InlinePart[]): string {
  return parts
    .map((part) => (part.kind === "text" ? part.text : serializeInlineChip(part.chip)))
    .join("");
}

function partLength(part: InlinePart): number {
  return part.kind === "text" ? part.text.length : serializeInlineChip(part.chip).length;
}

function pushText(parts: InlinePart[], text: string): void {
  if (text.length === 0) return;
  const last = parts[parts.length - 1];
  if (last?.kind === "text") {
    last.text += text;
    return;
  }
  parts.push({ kind: "text", text });
}

function parseStoredChip(raw: string): InlineChip | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.v !== 1) return null;
  if (value.kind !== "paste" && value.kind !== "mention") return null;
  if (typeof value.id !== "string" || value.id.length === 0) return null;
  if (typeof value.label !== "string" || value.label.length === 0) return null;
  if (typeof value.body !== "string") return null;
  return { id: value.id, kind: value.kind, label: value.label, body: value.body };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
