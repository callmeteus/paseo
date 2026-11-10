import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

export interface HubAutomationFile {
  path: string;
  content: string;
}

/**
 * Writes Hub prompt files into `.paseo/automations/` inside the run directory.
 * Paths stay relative. A path that leaves that folder is refused.
 */
export async function writeHubAutomationFiles(
  workspaceDirectory: string,
  files: readonly HubAutomationFile[] | undefined,
): Promise<void> {
  if (files === undefined || files.length === 0) return;
  const root = path.resolve(workspaceDirectory, ".paseo", "automations");
  await mkdir(root, { recursive: true });
  const rootReal = await realpath(root);
  const seen = new Set<string>();
  for (const file of files) {
    const relative = automationRelativePath(file.path);
    if (seen.has(relative)) {
      throw new Error(`automation file path is duplicated: ${relative}`);
    }
    seen.add(relative);
    const destination = path.resolve(root, relative);
    if (!isInside(root, destination)) {
      throw new Error(`automation file escapes its directory: ${relative}`);
    }
    await mkdir(path.dirname(destination), { recursive: true });
    const parentReal = await realpath(path.dirname(destination));
    if (!isInside(rootReal, parentReal)) {
      throw new Error(`automation file escapes its directory: ${relative}`);
    }
    if (await escapesThroughSymlink(destination, rootReal)) {
      throw new Error(`automation file escapes its directory: ${relative}`);
    }
    await writeFile(destination, file.content, "utf8");
  }
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function escapesThroughSymlink(destination: string, rootReal: string): Promise<boolean> {
  try {
    const existing = await lstat(destination);
    if (!existing.isSymbolicLink()) return false;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
  const real = await realpath(destination);
  return !isInside(rootReal, real);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function automationRelativePath(value: string): string {
  if (value.includes("\0")) throw new Error("automation file path contains a null byte");
  const normalized = value.replaceAll("\\", "/").trim();
  if (normalized.length === 0 || normalized.startsWith("/") || /^[a-zA-Z]:/u.test(normalized)) {
    throw new Error("automation file path must be relative");
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error("automation file path must not contain empty, '.' or '..' segments");
  }
  return segments.join("/");
}
