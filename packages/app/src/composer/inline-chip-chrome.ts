import type { Theme } from "@/styles/theme";
import { UnistylesRuntime } from "react-native-unistyles";

/** JS runtime exposes `getTheme`; web `.d.ts` still types it as `never`. */
export function getUnistylesAppTheme(): Theme {
  const rt = UnistylesRuntime as unknown as {
    getTheme: (name?: string) => Theme;
    themeName: string | undefined;
  };
  return rt.getTheme(rt.themeName);
}

/**
 * Inline paste/mention chip: same visual language as `StatusBadge` (surface + border + muted label),
 * not OpenCode’s orange fill.
 */
export function inlineChipChromeFromTheme(theme: Theme) {
  return {
    backgroundColor: theme.colors.surface3,
    color: theme.colors.foregroundMuted,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 3,
  } as const;
}

const FALLBACK_CHROME = {
  backgroundColor: "#e4e4e7",
  color: "#71717a",
  borderWidth: 1,
  borderColor: "#e4e4e7",
  borderRadius: 9999,
  paddingHorizontal: 8,
  paddingVertical: 3,
} as const;

/** Paint one chip span. The label is the only visible text; the body stays on the element. */
export function applyInlineChipDomStyle(element: HTMLElement, theme?: Theme): void {
  const resolved = theme ?? getUnistylesAppTheme();
  const chrome =
    resolved.colors.surface3 != null && resolved.spacing != null
      ? inlineChipChromeFromTheme(resolved)
      : FALLBACK_CHROME;
  element.style.backgroundColor = chrome.backgroundColor;
  element.style.color = chrome.color;
  element.style.borderWidth = `${chrome.borderWidth}px`;
  element.style.borderStyle = "solid";
  element.style.borderColor = chrome.borderColor;
  element.style.borderRadius = `${chrome.borderRadius}px`;
  element.style.padding = `${chrome.paddingVertical}px ${chrome.paddingHorizontal}px`;
  element.style.userSelect = "none";
  element.style.cursor = "pointer";
  element.style.whiteSpace = "pre";
}
