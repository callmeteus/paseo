export interface OpenUIRendererProps {
  code: string;
  streaming?: boolean;
  /** Send a conversational button action back to the agent. */
  onAction?: (message: string) => void;
}

/** Native fallback: OpenUI's DOM renderer is web-only, so Markdown wins on native. */
export function OpenUIRenderer(_props: OpenUIRendererProps): null {
  return null;
}
