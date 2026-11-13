import { promises as fs } from "node:fs";
import path from "node:path";
import { expandUserPath } from "../path-utils.js";

export interface FileSearchParams {
  root: string;
  relativePath?: string;
  query: string;
  mode: "name" | "content";
  caseSensitive?: boolean;
  maxResults?: number;
  /** Files larger than this are skipped in content mode. */
  maxFileBytes?: number;
}

export interface FileSearchMatch {
  path: string;
  line?: number;
  column?: number;
  preview?: string;
}

export interface FileSearchResult {
  path: string;
  matches: FileSearchMatch[];
  filesScanned: number;
  truncated: boolean;
}

const DEFAULT_MAX_RESULTS = 100;
const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
const PREVIEW_CHARS = 200;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".paseo",
  ".expo",
  ".cache",
]);

/** Searches file names or text content inside a workspace root. */
export async function searchWorkspaceFiles(params: FileSearchParams): Promise<FileSearchResult> {
  const query = params.query.trim();
  if (!query) throw new Error("query is required");
  const root = path.resolve(expandUserPath(params.root));
  const base = resolveInsideRoot(root, params.relativePath ?? ".");
  const maxResults = Math.max(1, params.maxResults ?? DEFAULT_MAX_RESULTS);
  const maxFileBytes = Math.max(1, params.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);
  const needle = params.caseSensitive ? query : query.toLowerCase();
  const matches: FileSearchMatch[] = [];
  let filesScanned = 0;
  let truncated = false;

  const stack: string[] = [base.absolute];
  while (stack.length > 0) {
    const directory = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (matches.length >= maxResults) {
        truncated = true;
        break;
      }
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      filesScanned += 1;
      const relativePath = toRelative(root, absolute);
      if (params.mode === "name") {
        const haystack = params.caseSensitive ? entry.name : entry.name.toLowerCase();
        if (haystack.includes(needle)) matches.push({ path: relativePath });
        continue;
      }
      const contentMatches = await searchFileContent({
        absolute,
        relativePath,
        needle,
        caseSensitive: params.caseSensitive === true,
        maxFileBytes,
        remaining: maxResults - matches.length,
      });
      matches.push(...contentMatches);
    }
    if (truncated) break;
  }

  return {
    path: toRelative(root, base.absolute) || ".",
    matches,
    filesScanned,
    truncated: truncated || matches.length >= maxResults,
  };
}

async function searchFileContent(input: {
  absolute: string;
  relativePath: string;
  needle: string;
  caseSensitive: boolean;
  maxFileBytes: number;
  remaining: number;
}): Promise<FileSearchMatch[]> {
  let handle;
  try {
    handle = await fs.open(input.absolute, "r");
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size === 0 || stats.size > input.maxFileBytes) return [];
    const buffer = Buffer.alloc(Number(stats.size));
    await handle.read(buffer, 0, buffer.length, 0);
    if (isBinary(buffer)) return [];
    const text = buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    const results: FileSearchMatch[] = [];
    for (let index = 0; index < lines.length && results.length < input.remaining; index += 1) {
      const line = lines[index]!;
      const haystack = input.caseSensitive ? line : line.toLowerCase();
      const column = haystack.indexOf(input.needle);
      if (column < 0) continue;
      results.push({
        path: input.relativePath,
        line: index + 1,
        column: column + 1,
        preview: line.trim().slice(0, PREVIEW_CHARS),
      });
    }
    return results;
  } catch {
    return [];
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function isBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function resolveInsideRoot(root: string, relativePath: string): { absolute: string } {
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path must stay inside the workspace");
  }
  return { absolute };
}

function toRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}
