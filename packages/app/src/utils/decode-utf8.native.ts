import { decodeWindows1252, looksLikeWindows1252 } from "./decode-windows-1252";

const CHUNK_BYTES = 0x8000;

/**
 * Decodes text, dropping a leading byte order mark and replacing malformed sequences. Bytes that
 * never form a multi-byte character are read as the Windows code page instead, so a CSV exported
 * by a Western Excel keeps its accents.
 *
 * Hermes has no native TextDecoder; the installed one decodes in JavaScript and takes ~260 ms for
 * 400 KB on an Android emulator. The engine's string builtins decode the same bytes in ~11 ms.
 */
export function decodeUtf8(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += CHUNK_BYTES) {
    const chunk = bytes.subarray(index, index + CHUNK_BYTES) as unknown as number[];
    binary += String.fromCharCode.apply(null, chunk);
  }
  let text: string;
  try {
    // escape() turns each byte above 0x7f into %XX, which decodeURIComponent reads as UTF-8.
    text = decodeURIComponent(escape(binary));
  } catch {
    // Malformed UTF-8: the full decoder substitutes U+FFFD for the bad sequences.
    const decoded = new TextDecoder().decode(bytes);
    return looksLikeWindows1252(bytes) ? decodeWindows1252(bytes) : decoded;
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
