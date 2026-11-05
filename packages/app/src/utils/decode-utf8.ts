import { decodeWindows1252, looksLikeWindows1252 } from "./decode-windows-1252";

/**
 * Decodes text, dropping a leading byte order mark and replacing malformed sequences. Bytes that
 * never form a multi-byte character are read as the Windows code page instead, so a CSV exported
 * by a Western Excel keeps its accents.
 */
export function decodeUtf8(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes);
  if (!text.includes("\uFFFD") || !looksLikeWindows1252(bytes)) return text;
  return decodeWindows1252(bytes);
}
