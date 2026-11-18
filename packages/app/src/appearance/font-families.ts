import type { ComboboxOption } from "@/components/ui/combobox";
import { DEFAULT_MONO_FONT_STACK, DEFAULT_UI_FONT_STACK } from "@/styles/theme";

/** Product default for the interface. Bundled on web from the allo-font package. */
export const DEFAULT_UI_FONT_FAMILY = "Allo";

/** Combobox id for the platform stack. It is not a font family name. */
export const SYSTEM_FONT_OPTION_ID = "{system}";

export interface FontSuggestion {
  /** Value stored in settings and passed to CSS. */
  id: string;
  label: string;
}

function suggestion(label: string): FontSuggestion {
  return { id: label.includes(" ") ? `'${label}'` : label, label };
}

export interface InstalledFace {
  family: string;
  /** Null when the platform list does not say whether the face is monospace. */
  monospace: boolean | null;
}

const MONO_WIDTH_RATIO = 0.08;

export function widthsAreMonospace(widths: { wide: number; narrow: number } | null): boolean {
  if (!widths || widths.wide <= 0) return false;
  return Math.abs(widths.wide - widths.narrow) / widths.wide < MONO_WIDTH_RATIO;
}

export function resolveInstalledFace(
  face: InstalledFace,
  widths: { wide: number; narrow: number } | null,
): InstalledFace {
  if (face.monospace !== null) return face;
  return { family: face.family, monospace: widthsAreMonospace(widths) };
}

/**
 * Interface suggestions are the proportional faces on this machine, with Allo
 * first because the app bundles it. Code suggestions are the monospace faces.
 */
export function suggestionsForInstalledFaces(
  faces: readonly InstalledFace[],
  kind: "ui" | "mono",
): FontSuggestion[] {
  const wantedMono = kind === "mono";
  const suggestions = faces
    .filter((face) => face.monospace === wantedMono)
    .map((face) => suggestion(face.family));
  if (kind === "mono") return suggestions;
  const withoutAllo = suggestions.filter((entry) => entry.id !== DEFAULT_UI_FONT_FAMILY);
  return [suggestion(DEFAULT_UI_FONT_FAMILY), ...withoutAllo];
}

/**
 * A single family with spaces has to be quoted or CSS reads each word as its own family.
 * Stacks (anything with a comma) are left as the user typed them.
 */
export function canonicalizeFontFamily(value: string): string {
  if (value.length === 0 || value.includes(",")) return value;
  if (value.startsWith("'") || value.startsWith('"')) return value;
  if (!value.includes(" ")) return value;
  return `'${value.replaceAll("'", "\\'")}'`;
}

export function fontFamilyLabel(
  value: string,
  suggestions: readonly FontSuggestion[],
  systemLabel: string,
): string {
  if (value.length === 0) return systemLabel;
  const match = suggestions.find((entry) => entry.id === value);
  if (match) return match.label;
  if (
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2) ||
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function buildFontFamilyOptions(input: {
  value: string;
  suggestions: readonly FontSuggestion[];
  systemLabel: string;
}): ComboboxOption[] {
  const options: ComboboxOption[] = [
    { id: SYSTEM_FONT_OPTION_ID, label: input.systemLabel },
    ...input.suggestions.map((entry) => ({ id: entry.id, label: entry.label })),
  ];
  const current = input.value.trim();
  if (current.length > 0 && !options.some((option) => option.id === current)) {
    options.push({
      id: current,
      label: fontFamilyLabel(current, input.suggestions, input.systemLabel),
    });
  }
  return options;
}

export function resolveUiFontStack(family: string, native: boolean): string {
  const trimmed = family.trim();
  if (trimmed.length === 0 || (trimmed === DEFAULT_UI_FONT_FAMILY && native)) {
    return DEFAULT_UI_FONT_STACK;
  }
  if (trimmed === DEFAULT_UI_FONT_FAMILY) {
    return `${DEFAULT_UI_FONT_FAMILY}, ${DEFAULT_UI_FONT_STACK}`;
  }
  const canonical = canonicalizeFontFamily(trimmed);
  return canonical.length === 0 ? DEFAULT_UI_FONT_STACK : canonical;
}

export function resolveMonoFontStack(family: string): string {
  const canonical = canonicalizeFontFamily(family.trim());
  return canonical.length === 0 ? DEFAULT_MONO_FONT_STACK : canonical;
}
