import { describe, expect, it } from "vitest";
import { decodeUtf8 } from "./decode-utf8.native";

function decodesLikeTextDecoder(bytes: Uint8Array) {
  expect(decodeUtf8(bytes)).toBe(new TextDecoder().decode(bytes));
}

describe("decodeUtf8 on native", () => {
  it("decodes ASCII, multibyte characters and emoji across chunk boundaries", () => {
    const text = "const café = '中文 🙂 %20 100%';\n".repeat(4000);
    decodesLikeTextDecoder(new TextEncoder().encode(text));
    expect(decodeUtf8(new TextEncoder().encode(text))).toBe(text);
  });

  it("drops a leading byte order mark", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]);
    expect(decodeUtf8(bytes)).toBe("hi");
  });

  it("reads a single-byte code page file instead of replacing its accents", () => {
    // "João" written by a Western spreadsheet export.
    expect(decodeUtf8(new Uint8Array([0x4a, 0x6f, 0xe3, 0x6f]))).toBe("João");
  });

  it("replaces a damaged sequence inside an otherwise valid file", () => {
    const bytes = new Uint8Array([...new TextEncoder().encode("café "), 0xff]);
    expect(decodeUtf8(bytes)).toBe("café \uFFFD");
  });

  it("decodes an empty file", () => {
    expect(decodeUtf8(new Uint8Array())).toBe("");
  });
});
