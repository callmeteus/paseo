import type { ReactElement } from "react";

/** Native has no in-page find widget for the markdown preview; web owns it. */
export function MarkdownPreviewFind(_props: {
  root: React.RefObject<HTMLElement | null>;
  scrollContainer: React.RefObject<HTMLElement | null>;
}): ReactElement | null {
  return null;
}
