/**
 * Provider ids are lowercase slugs. Naive capitalization turns "opencode" into
 * "Opencode", which is not the brand. The daemon's provider catalog carries the
 * official title, but code that only receives an id (panel subtitles, error
 * cards) needs a local table.
 */
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  opencode: "OpenCode",
};

export function providerDisplayName(provider: string): string {
  const known = PROVIDER_DISPLAY_NAMES[provider];
  if (known) return known;
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
