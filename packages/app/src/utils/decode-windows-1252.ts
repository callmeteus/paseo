/** windows-1252 code points for 0x80–0x9F; every other byte maps to the same code point. */
const CONTROL_RANGE_CODE_POINTS = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x008d, 0x017d, 0x008f, 0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
] as const;

const CODE_POINTS: readonly number[] = Array.from({ length: 256 }, (_, byte) =>
  byte >= 0x80 && byte <= 0x9f ? CONTROL_RANGE_CODE_POINTS[byte - 0x80] : byte,
);

/** Bytes per `String.fromCharCode` call; the argument limit is platform dependent. */
const CHUNK_BYTES = 0x1000;

/** Decodes text written in the Windows code page, which Western spreadsheet exports still use. */
export function decodeWindows1252(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length; index += CHUNK_BYTES) {
    const chunk = bytes.subarray(index, index + CHUNK_BYTES);
    const units: number[] = [];
    for (let offset = 0; offset < chunk.length; offset += 1) units.push(CODE_POINTS[chunk[offset]]);
    text += String.fromCharCode(...units);
  }
  return text;
}

/**
 * Whether bytes that fail UTF-8 look like a single-byte code page instead of a UTF-8 file with a
 * damaged sequence: high bytes present, and not one well-formed multi-byte character to show for
 * them. "João" in windows-1252 is exactly that; "café" in UTF-8 is not.
 */
export function looksLikeWindows1252(bytes: Uint8Array): boolean {
  let hasHighByte = false;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte < 0x80) continue;
    hasHighByte = true;
    const length = utf8SequenceLength(byte);
    if (length > 0 && isContinuationRun(bytes, index + 1, length - 1)) return false;
  }
  return hasHighByte;
}

function utf8SequenceLength(byte: number): number {
  if (byte >= 0xf0) return 4;
  if (byte >= 0xe0) return 3;
  if (byte >= 0xc2) return 2;
  return 0;
}

function isContinuationRun(bytes: Uint8Array, start: number, count: number): boolean {
  for (let offset = 0; offset < count; offset += 1) {
    const byte = bytes[start + offset];
    if (byte === undefined || (byte & 0xc0) !== 0x80) return false;
  }
  return true;
}
