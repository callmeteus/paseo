export interface ComposerListMarker {
  start: number;
  end: number;
  kind: "bullet" | "ordered";
}

export interface ComposerMirrorPiece {
  start: number;
  text: string;
  kind: "plain" | "skill" | "bullet" | "ordered";
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
