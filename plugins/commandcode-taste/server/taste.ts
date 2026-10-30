import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";

export const TASTE_BLOCK_START = "<paseo-commandcode-taste>";
export const TASTE_BLOCK_END = "</paseo-commandcode-taste>";
const COMMANDCODE_DIRECTORY = ".commandcode";
const TASTE_DIRECTORY = "taste";
const TASTE_FILE_NAME = "taste.md";
const MAX_WALK_DEPTH = 20;
const MIN_SECTION_BUDGET = 32;

export type TasteScope = "project" | "global";

export interface TasteFileRecord {
  scope: TasteScope;
  /** Absolute path, so the app can open the file. */
  path: string;
  /** Project-relative path, or `~`-prefixed for global packages. */
  relativePath: string;
  bytes: number;
  modifiedAt: string;
  content: string;
}

export interface TasteSnapshot {
  projectRoot: string | null;
  files: TasteFileRecord[];
}

export interface TasteLearningState {
  enabled: boolean;
  /** File that decided the setting, or null when nothing set it (learning is on). */
  source: string | null;
}

export interface ComposedTaste {
  block: string;
  truncated: boolean;
  fileCount: number;
}

function homeDirectory(env: NodeJS.ProcessEnv): string {
  return env["HOME"] || env["USERPROFILE"] || homedir();
}

function toDisplayPath(value: string): string {
  return value.split(sep).join("/");
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Finds the project that owns `.commandcode/taste` by walking up from the chat cwd.
 * Command Code itself reads the taste directory of the project the process runs in,
 * so this mirrors that lookup for workspaces opened in a subdirectory.
 */
export async function findTasteProjectRoot(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const home = homeDirectory(env);
  let current = cwd;
  for (let depth = 0; depth < MAX_WALK_DEPTH; depth += 1) {
    // `~/.commandcode/taste` is the global profile, never a project profile.
    if (current === home) return null;
    if (await isDirectory(join(current, COMMANDCODE_DIRECTORY, TASTE_DIRECTORY))) {
      return current;
    }
    // A repo root is the project boundary; taste above it belongs to another project.
    if (await isDirectory(join(current, ".git"))) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

async function readTasteFile(
  path: string,
  scope: TasteScope,
  relativePath: string,
): Promise<TasteFileRecord | null> {
  try {
    const [stats, content] = await Promise.all([fs.stat(path), fs.readFile(path, "utf8")]);
    if (!stats.isFile() || content.trim().length === 0) return null;
    return {
      scope,
      path,
      relativePath: toDisplayPath(relativePath),
      bytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      content,
    };
  } catch {
    return null;
  }
}

/** Reads the root taste file and one `taste.md` per category directory. */
export async function readTasteDirectory(input: {
  directory: string;
  scope: TasteScope;
  /** Prefix used in relative paths: `""` for project, `~` for global. */
  displayPrefix: string;
}): Promise<TasteFileRecord[]> {
  const base = join(input.displayPrefix, COMMANDCODE_DIRECTORY, TASTE_DIRECTORY);
  const files: TasteFileRecord[] = [];
  const root = await readTasteFile(
    join(input.directory, TASTE_FILE_NAME),
    input.scope,
    join(base, TASTE_FILE_NAME),
  );
  if (root) files.push(root);

  let entries;
  try {
    entries = await fs.readdir(input.directory, { withFileTypes: true });
  } catch {
    return files;
  }
  const categories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  for (const category of categories) {
    const file = await readTasteFile(
      join(input.directory, category, TASTE_FILE_NAME),
      input.scope,
      join(base, category, TASTE_FILE_NAME),
    );
    if (file) files.push(file);
  }
  return files;
}

export async function readTasteSnapshot(
  cwd: string,
  includeGlobal: boolean,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TasteSnapshot> {
  const projectRoot = await findTasteProjectRoot(cwd, env);
  const files = projectRoot
    ? await readTasteDirectory({
        directory: join(projectRoot, COMMANDCODE_DIRECTORY, TASTE_DIRECTORY),
        scope: "project",
        displayPrefix: "",
      })
    : [];
  if (includeGlobal) {
    const globalFiles = await readTasteDirectory({
      directory: join(homeDirectory(env), COMMANDCODE_DIRECTORY, TASTE_DIRECTORY),
      scope: "global",
      displayPrefix: "~",
    });
    const seen = new Set(files.map((file) => file.path));
    files.push(...globalFiles.filter((file) => !seen.has(file.path)));
  }
  return { projectRoot, files };
}

async function readTasteLearningValue(path: string): Promise<boolean | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path, "utf8"));
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = (parsed as Record<string, unknown>)["tasteLearning"];
    return typeof value === "boolean" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the effective taste learning flag in Command Code's own precedence order:
 * settings.local.json, settings.json, then the user config.
 */
export async function readTasteLearning(
  projectRoot: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TasteLearningState> {
  const candidates: Array<{ path: string; display: string }> = [];
  if (projectRoot) {
    candidates.push(
      {
        path: join(projectRoot, COMMANDCODE_DIRECTORY, "settings.local.json"),
        display: `${COMMANDCODE_DIRECTORY}/settings.local.json`,
      },
      {
        path: join(projectRoot, COMMANDCODE_DIRECTORY, "settings.json"),
        display: `${COMMANDCODE_DIRECTORY}/settings.json`,
      },
    );
  }
  candidates.push({
    path: join(homeDirectory(env), COMMANDCODE_DIRECTORY, "config.json"),
    display: `~/${COMMANDCODE_DIRECTORY}/config.json`,
  });

  for (const candidate of candidates) {
    const enabled = await readTasteLearningValue(candidate.path);
    if (enabled !== null) return { enabled, source: candidate.display };
  }
  return { enabled: true, source: null };
}

/**
 * Builds the prompt block injected into other providers. The footer and per-file
 * headers are kept when the profile is over the cap, so the agent can tell the
 * content was cut instead of treating a partial preference as complete.
 */
export function composeTasteBlock(files: TasteFileRecord[], maxChars: number): ComposedTaste {
  if (files.length === 0 || maxChars <= 0) {
    return { block: "", truncated: false, fileCount: files.length };
  }
  const header = [
    TASTE_BLOCK_START,
    "The user's coding preferences learned by Command Code. Follow them unless the user says otherwise.",
  ].join("\n");
  const footer = TASTE_BLOCK_END;
  const sections: string[] = [];
  let remaining = maxChars - header.length - footer.length - 1;
  let truncated = false;

  for (const file of files) {
    if (remaining <= MIN_SECTION_BUDGET) {
      truncated = true;
      break;
    }
    const sectionHeader = `\n\n--- ${file.scope}: ${file.relativePath} ---\n`;
    const budget = remaining - sectionHeader.length;
    if (budget <= MIN_SECTION_BUDGET) {
      truncated = true;
      break;
    }
    const content = file.content.trim();
    if (content.length > budget) {
      const slice = content.slice(0, budget - 20).trimEnd();
      sections.push(`${sectionHeader}${slice}\n… (truncated)`);
      truncated = true;
      break;
    }
    sections.push(`${sectionHeader}${content}`);
    remaining -= sectionHeader.length + content.length;
  }

  if (sections.length === 0) {
    return { block: "", truncated, fileCount: files.length };
  }
  return {
    block: `${header}${sections.join("")}\n${footer}`,
    truncated,
    fileCount: files.length,
  };
}

/** Appends the block once. An existing block is left untouched so provider swaps stay idempotent. */
export function appendTasteBlock(
  systemPrompt: string | undefined,
  block: string,
): string | undefined {
  if (!block || systemPrompt?.includes(TASTE_BLOCK_START)) return systemPrompt;
  const base = systemPrompt?.trim();
  return base ? `${base}\n\n${block}` : block;
}

export function shouldInjectTaste(provider: string, applyToOtherProviders: boolean): boolean {
  // Command Code reads its own taste files; ACP ignores systemPrompt, so injecting would
  // only store a block nothing consumes.
  return applyToOtherProviders && provider !== "commandcode";
}
