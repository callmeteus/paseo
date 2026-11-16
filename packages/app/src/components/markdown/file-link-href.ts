import { pathToFileUri } from "@/attachments/utils";

/**
 * Absolute paths must be file URLs. A path-absolute href resolves against
 * `paseo://app` or the dev server, so the desktop menu has no folder address to copy.
 */
export function localFileLinkHref(href: string): string | null {
  const fileHref = pathToFileUri(href);
  return fileHref.startsWith("file://") ? fileHref : null;
}
