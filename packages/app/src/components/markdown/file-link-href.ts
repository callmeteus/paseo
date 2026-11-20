import { pathToFileUri } from "@/attachments/utils";

/**
 * Absolute paths must be file URLs. A path-absolute href resolves against
 * `paseo://app` or the dev server, so the desktop menu has no folder address to copy.
 */
export function localFileLinkHref(href: string): string | null {
  const fileHref = pathToFileUri(href);
  return fileHref.startsWith("file://") ? fileHref : null;
}

const DOMAIN_LIKE_URL = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:[/:?#]|$)/;

/**
 * Prose often mentions a host without a scheme, like `github.com/settings/apps/new`.
 * The markdown recognizer makes it a link, but a relative href makes the click a
 * no-op and hides the desktop "Copy Link Address" and "Open Link in Browser"
 * menu entries. Add the scheme so the shared link path treats it as external.
 */
export function normalizeMarkdownLinkHref(href: string): string {
  const trimmed = href.trim();
  if (!trimmed || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith("//")) {
    return href;
  }
  return DOMAIN_LIKE_URL.test(trimmed) ? `https://${trimmed}` : href;
}
