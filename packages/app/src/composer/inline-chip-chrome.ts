import { baseColors, BORDER_RADIUS, lightTheme, SPACING } from "@/styles/theme";

/**
 * The orange atom OpenCode uses for a paste. Paste chips and mention chips share it
 * so a mention in the sentence is the same kind of control, not a second design.
 * The fill is the orange token, the text is the light theme's foreground so it
 * stays readable on that fill in either theme, and the radius and padding are
 * the control scale.
 */
export const inlineChipChrome = {
  backgroundColor: baseColors.orange[500],
  color: lightTheme.colors.foreground,
  borderRadius: BORDER_RADIUS.md,
  paddingHorizontal: SPACING[1.5],
  paddingVertical: SPACING[0.5],
} as const;

/** Paint one chip span. The label is the only visible text; the body stays on the element. */
export function applyInlineChipDomStyle(element: HTMLElement): void {
  element.style.backgroundColor = inlineChipChrome.backgroundColor;
  element.style.color = inlineChipChrome.color;
  element.style.borderRadius = `${inlineChipChrome.borderRadius}px`;
  element.style.padding = `${inlineChipChrome.paddingVertical}px ${inlineChipChrome.paddingHorizontal}px`;
  element.style.userSelect = "none";
  element.style.cursor = "pointer";
  element.style.whiteSpace = "pre";
}
