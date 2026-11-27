import { parseServerIdFromPathname } from "./host-routes";

/**
 * Which host the user is looking at, from the shell's point of view.
 *
 * A pinned host tab (a single sidebar host filter) wins, then the host in the
 * URL, then the last opened workspace. Anything that opens a host-scoped
 * surface from the app chrome should use this instead of asking the user which
 * host they meant.
 */
export function resolveActiveHostServerId(input: {
  hostFilters: readonly string[];
  pathname: string;
  lastServerId?: string | null;
}): string | null {
  const pinnedHostId = input.hostFilters.length === 1 ? input.hostFilters[0] : null;
  return pinnedHostId ?? parseServerIdFromPathname(input.pathname) ?? input.lastServerId ?? null;
}
