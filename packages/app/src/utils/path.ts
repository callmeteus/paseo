const WINDOWS_LINE_SUFFIX = /^(.+?):([0-9]+)(?::[0-9]+)?(?:-([0-9]+)(?::[0-9]+)?)?$/;

export function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(value);
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function stripWindowsLineSuffix(value: string): string {
  const base = WINDOWS_LINE_SUFFIX.exec(value)?.[1];
  return base && isWindowsAbsolutePath(base) ? base : value;
}

/**
 * Puts a Windows absolute path back into the backslash form the author wrote,
 * drive prefix included. A trailing line marker (`file.ts:12`) is removed.
 * Relative and POSIX paths return null: the missing prefix cannot be guessed.
 */
export function restoreWindowsFilePath(value: string): string | null {
  const trimmed = value
    .trim()
    .replace(/^['"`]/, "")
    .replace(/['"`]$/, "");
  if (!trimmed) {
    return null;
  }

  const path = stripWindowsLineSuffix(trimmed);
  if (!isWindowsAbsolutePath(path)) {
    return null;
  }

  if (path.startsWith("\\\\")) {
    return path.replace(/\//g, "\\");
  }

  return `${path.slice(0, 2)}${path.slice(2).replace(/\//g, "\\")}`;
}

/** Last path segment, for either Windows or POSIX separators. */
export function pathBasename(path: string): string {
  return path.split(/[\\/]/).findLast(Boolean) ?? path;
}

/** Resolves a workspace-relative path against its root; absolute paths pass through. */
export function resolveWorkspacePath(path: string, workspaceRoot: string): string {
  const trimmed = path.trim();
  if (!trimmed || isAbsolutePath(trimmed) || workspaceRoot.trim().length === 0) {
    return trimmed;
  }
  const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = trimmed.replace(/\\/g, "/").split("/");
  const normalized: string[] = [];
  for (const segment of segments) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }
  return normalized.length > 0 ? `${root}/${normalized.join("/")}` : root;
}
