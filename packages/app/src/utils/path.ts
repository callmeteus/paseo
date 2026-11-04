export function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(value);
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
