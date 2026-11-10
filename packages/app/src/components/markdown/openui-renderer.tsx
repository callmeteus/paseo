export interface OpenUIRendererProps {
  code: string;
  streaming?: boolean;
}

/** Native fallback: OpenUI's DOM renderer is web-only, so Markdown wins on native. */
export function OpenUIRenderer(_props: OpenUIRendererProps): null {
  return null;
}
