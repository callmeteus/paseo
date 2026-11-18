import { describe, expect, it } from "vitest";
import { DEFAULT_MONO_FONT_STACK, DEFAULT_UI_FONT_STACK } from "@/styles/theme";
import {
  DEFAULT_UI_FONT_FAMILY,
  SYSTEM_FONT_OPTION_ID,
  buildFontFamilyOptions,
  canonicalizeFontFamily,
  fontFamilyLabel,
  resolveInstalledFace,
  resolveMonoFontStack,
  resolveUiFontStack,
  suggestionsForInstalledFaces,
  widthsAreMonospace,
  type InstalledFace,
} from "./font-families";

const INSTALLED: readonly InstalledFace[] = [
  { family: "Liberation Mono", monospace: true },
  { family: "Ubuntu", monospace: false },
  { family: "Ubuntu Mono", monospace: true },
];

describe("installed font suggestions", () => {
  it("suggests installed proportional faces and keeps bundled Allo first", () => {
    expect(suggestionsForInstalledFaces(INSTALLED, "ui").map((entry) => entry.label)).toEqual([
      "Allo",
      "Ubuntu",
    ]);
    expect(suggestionsForInstalledFaces(INSTALLED, "mono").map((entry) => entry.label)).toEqual([
      "Liberation Mono",
      "Ubuntu Mono",
    ]);
  });

  it("quotes a family that contains spaces", () => {
    expect(
      suggestionsForInstalledFaces([{ family: "Liberation Mono", monospace: true }], "mono"),
    ).toEqual([{ id: "'Liberation Mono'", label: "Liberation Mono" }]);
  });

  it("treats equal advance widths as monospace and leaves a known face alone", () => {
    expect(widthsAreMonospace({ wide: 100, narrow: 100 })).toBe(true);
    expect(widthsAreMonospace({ wide: 120, narrow: 40 })).toBe(false);
    expect(widthsAreMonospace(null)).toBe(false);
    expect(
      resolveInstalledFace({ family: "Ubuntu", monospace: false }, { wide: 100, narrow: 100 }),
    ).toEqual({ family: "Ubuntu", monospace: false });
    expect(
      resolveInstalledFace({ family: "Menlo", monospace: null }, { wide: 90, narrow: 90 }),
    ).toEqual({ family: "Menlo", monospace: true });
  });
});

describe("font family options", () => {
  const uiSuggestions = suggestionsForInstalledFaces(INSTALLED, "ui");

  it("lists the platform stack, then suggestions, then a custom current family", () => {
    const options = buildFontFamilyOptions({
      value: "Comic Sans MS",
      suggestions: uiSuggestions,
      systemLabel: "System default",
    });

    expect(options[0]).toEqual({ id: SYSTEM_FONT_OPTION_ID, label: "System default" });
    expect(options.map((option) => option.label)).toContain("Ubuntu");
    expect(options.at(-1)).toEqual({ id: "Comic Sans MS", label: "Comic Sans MS" });
  });

  it("does not duplicate a suggestion that is already selected", () => {
    const options = buildFontFamilyOptions({
      value: DEFAULT_UI_FONT_FAMILY,
      suggestions: uiSuggestions,
      systemLabel: "System default",
    });

    expect(options.filter((option) => option.id === DEFAULT_UI_FONT_FAMILY)).toHaveLength(1);
  });

  it("shows a stored quoted family without the quotes", () => {
    expect(fontFamilyLabel("'IBM Plex Sans'", uiSuggestions, "System default")).toBe(
      "IBM Plex Sans",
    );
    expect(fontFamilyLabel("", uiSuggestions, "System default")).toBe("System default");
  });
});

describe("font family resolution", () => {
  it("quotes a single family that contains spaces and leaves stacks alone", () => {
    expect(canonicalizeFontFamily("JetBrains Mono")).toBe("'JetBrains Mono'");
    expect(canonicalizeFontFamily("'Fira Code', monospace")).toBe("'Fira Code', monospace");
    expect(canonicalizeFontFamily("Allo")).toBe("Allo");
    expect(canonicalizeFontFamily("")).toBe("");
  });

  it("uses Allo ahead of the platform stack on web and the platform stack on native", () => {
    expect(resolveUiFontStack(DEFAULT_UI_FONT_FAMILY, false)).toBe(
      `${DEFAULT_UI_FONT_FAMILY}, ${DEFAULT_UI_FONT_STACK}`,
    );
    expect(resolveUiFontStack(DEFAULT_UI_FONT_FAMILY, true)).toBe(DEFAULT_UI_FONT_STACK);
    expect(resolveUiFontStack("", false)).toBe(DEFAULT_UI_FONT_STACK);
    expect(resolveUiFontStack("  Menlo  ", false)).toBe("Menlo");
  });

  it("resolves an empty code font to the platform mono stack", () => {
    expect(resolveMonoFontStack("")).toBe(DEFAULT_MONO_FONT_STACK);
    expect(resolveMonoFontStack("JetBrains Mono")).toBe("'JetBrains Mono'");
  });
});
