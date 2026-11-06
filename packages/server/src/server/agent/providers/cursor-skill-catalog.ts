import { basename, dirname, isAbsolute, join, parse, resolve, sep } from "node:path";

/**
 * Directories the Cursor ACP agent reads when it builds slash commands.
 *
 * `cursor-agent` loads them once per process (`loadCommandsAndSkills`) from the
 * nearest git root and the user home. It does not watch the disk, and it does
 * not scan nested repositories. This module plans those same directories so a
 * later reload of that process sees a skill created after the chat opened.
 */

/** Trailing debounce before a skill write reloads an open Cursor chat. */
export const CURSOR_SKILL_CATALOG_RELOAD_DEBOUNCE_MS = 400;

/** File name `cursor-agent` treats as a skill definition. */
export const CURSOR_SKILL_FILE_NAME = "SKILL.md";

interface CursorSkillSource {
  configDir: string;
  subdir: string;
  /** Dropped unless third-party extensibility is on. ACP leaves it on. */
  thirdParty: boolean;
  builtin: boolean;
}

/**
 * `Ds` in cursor-agent, minus the builtin entry. `Hs` keeps every non-builtin
 * row when third-party extensibility is enabled.
 */
const CURSOR_ACP_SKILL_SOURCES: readonly CursorSkillSource[] = [
  { configDir: ".cursor", subdir: "skills", thirdParty: false, builtin: false },
  { configDir: ".claude", subdir: "skills", thirdParty: true, builtin: false },
  { configDir: ".codex", subdir: "skills", thirdParty: true, builtin: false },
  { configDir: ".grok", subdir: "skills", thirdParty: true, builtin: false },
  { configDir: ".agents", subdir: "skills", thirdParty: false, builtin: false },
];

/** `$s` / `c$0`: bundled skills, user home only. */
const CURSOR_ACP_BUILTIN_SKILL: CursorSkillSource = {
  configDir: ".cursor",
  subdir: "skills-cursor",
  thirdParty: false,
  builtin: true,
};

export type SkillCatalogChangeType = "create" | "update" | "delete";

export interface SkillCatalogChange {
  path: string;
  type: SkillCatalogChangeType;
}

export interface SkillCatalogShallowWatch {
  /** Existing directory that receives a non-recursive watch. */
  directory: string;
  /** Next path segment toward a skill root that does not exist yet. */
  expectChild: string;
}

export interface SkillCatalogWatchPlan {
  /** Skill roots that already exist. Watch these recursively. */
  recursive: string[];
  /** Nearest existing ancestor of a skill root that does not exist yet. */
  shallow: SkillCatalogShallowWatch[];
}

export interface CursorSkillReloadAgent {
  agentId: string;
  provider: string;
  cwd: string;
  lifecycle: "initializing" | "idle" | "running" | "error" | "closed";
  /** True when a turn is in flight, even if the lifecycle label is already idle. */
  busy: boolean;
  internal?: boolean;
}

export type CursorSkillReloadScope = { kind: "user" } | { kind: "project"; projectRoot: string };

/**
 * Nearest git ancestor of `start`, or `start` itself when there is none.
 *
 * Matches cursor-agent `getProjectRoot` (`ky` in `src/utils/git.ts`): a `.git`
 * file counts, so a worktree is a project root, and a nested repository is not
 * walked into from its parent.
 *
 * @param start - Chat working directory.
 * @param exists - True when the path is present, including a `.git` file.
 * @returns Absolute project root cursor-agent would pass to `loadCommands`.
 */
export function cursorProjectRoot(start: string, exists: (path: string) => boolean): string {
  const original = resolve(start);
  let current = original;
  const filesystemRoot = parse(current).root;
  for (;;) {
    if (exists(join(current, ".git"))) return current;
    if (current === filesystemRoot) return original;
    const parent = dirname(current);
    if (parent === current) return original;
    current = parent;
  }
}

/**
 * Project skill directories ACP passes to `loadSkillRoots` for one root.
 *
 * Does not include `skills-cursor` and does not include a nested repo's
 * `.cursor/skills`.
 *
 * @param projectRoot - Value from {@link cursorProjectRoot}.
 * @param thirdPartyExtensibility - ACP default is on.
 * @returns Absolute directories, whether or not they exist.
 */
export function cursorProjectSkillRoots(
  projectRoot: string,
  thirdPartyExtensibility = true,
): string[] {
  return skillDirectories(resolve(projectRoot), thirdPartyExtensibility, false);
}

/**
 * User and builtin skill directories ACP reads under the home directory.
 *
 * @param homeDirectory - `os.homedir()`, the same directory cursor-agent uses.
 * @param thirdPartyExtensibility - ACP default is on.
 * @returns Absolute directories, whether or not they exist.
 */
export function cursorUserSkillRoots(
  homeDirectory: string,
  thirdPartyExtensibility = true,
): string[] {
  return skillDirectories(resolve(homeDirectory), thirdPartyExtensibility, true);
}

/**
 * Project plus user skill directories for one chat root.
 *
 * @param input - Project root, home, and the ACP third-party flag.
 * @returns Deduped absolute directories.
 */
export function cursorSkillCatalogRoots(input: {
  projectRoot: string;
  homeDirectory: string;
  thirdPartyExtensibility?: boolean;
}): string[] {
  const thirdParty = input.thirdPartyExtensibility ?? true;
  return dedupe([
    ...cursorProjectSkillRoots(input.projectRoot, thirdParty),
    ...cursorUserSkillRoots(input.homeDirectory, thirdParty),
  ]);
}

/**
 * Watches for the skill roots discovery already reads.
 *
 * An existing root is recursive. A missing root watches only the nearest
 * existing ancestor, and only for the next path segment, so creating
 * `.cursor/skills` is visible without watching the whole workspace or `/`.
 *
 * @param input - Catalog directories and an existence check.
 * @returns Recursive directories and shallow ancestor watches.
 */
export function planSkillCatalogWatches(input: {
  roots: readonly string[];
  exists: (path: string) => boolean;
}): SkillCatalogWatchPlan {
  const recursive: string[] = [];
  const shallow: SkillCatalogShallowWatch[] = [];
  for (const root of input.roots) {
    const watch = watchForRoot(root, input.exists);
    if (!watch) continue;
    if (watch.kind === "recursive") recursive.push(watch.directory);
    else shallow.push(watch);
  }
  const collapsed = collapseParents(recursive);
  const shallowFiltered = shallow.filter(
    (entry) => !collapsed.some((directory) => isSameOrInside(directory, entry.directory)),
  );
  return {
    recursive: collapsed,
    shallow: dedupeShallow(shallowFiltered),
  };
}

/**
 * True when this change can add, edit, or remove a slash command from a skill.
 *
 * Updates reload only for `SKILL.md`, so editing another file in the same tree
 * does not restart the agent on every keystroke. Creates and deletes of the
 * skill directory (or of `SKILL.md`) do reload.
 *
 * @param input - Changed path, event type, and the catalog roots.
 * @returns Whether the open Cursor catalog should be read again.
 */
export function shouldReloadCursorSkillCatalog(input: {
  changedPath: string;
  changeType: SkillCatalogChangeType;
  roots: readonly string[];
}): boolean {
  const changed = resolve(input.changedPath);
  const inside = input.roots.some((root) => isSameOrInside(root, changed));
  if (!inside) return false;
  if (basename(changed) === CURSOR_SKILL_FILE_NAME) return true;
  return input.changeType !== "update";
}

/**
 * True when a parent of a skill root just appeared and that root is now on disk.
 *
 * A non-recursive watch on the ancestor only sees the next segment (`.cursor`),
 * while `SKILL.md` may already have been written underneath it.
 *
 * @param input - Path that appeared, catalog roots, and an existence check.
 * @returns Whether the catalog should be read again.
 */
export function shouldReloadAfterCatalogAncestorAppeared(input: {
  appearedPath: string;
  roots: readonly string[];
  exists: (path: string) => boolean;
}): boolean {
  const appeared = resolve(input.appearedPath);
  return input.roots.some(
    (root) => input.exists(resolve(root)) && isSameOrInside(appeared, resolve(root)),
  );
}

/**
 * True when a deleted path is an ancestor of a skill root.
 *
 * Removing `.cursor` drops every skill under it even when the watcher did not
 * see each `SKILL.md` delete.
 *
 * @param input - Deleted path and catalog roots.
 * @returns Whether the catalog should be read again.
 */
export function shouldReloadAfterCatalogAncestorRemoved(input: {
  removedPath: string;
  roots: readonly string[];
}): boolean {
  const removed = resolve(input.removedPath);
  return input.roots.some((root) => {
    const resolved = resolve(root);
    return removed !== resolved && isSameOrInside(removed, resolved);
  });
}

/**
 * Which open chats a batch of filesystem events should refresh.
 *
 * A user-home change refreshes every Cursor chat. A project change refreshes
 * chats whose git root is that project. One user-home hit covers the rest.
 *
 * @param input - Events, user roots, per-project roots, and an existence check.
 * @returns Reload scopes, user first when both match.
 */
export function skillCatalogReloadScopes(input: {
  changes: readonly SkillCatalogChange[];
  userRoots: readonly string[];
  projects: readonly { projectRoot: string; directories: readonly string[] }[];
  exists: (path: string) => boolean;
}): CursorSkillReloadScope[] {
  if (input.changes.some((change) => changeTouchesRoots(change, input.userRoots, input.exists))) {
    return [{ kind: "user" }];
  }
  const scopes: CursorSkillReloadScope[] = [];
  for (const project of input.projects) {
    if (
      input.changes.some((change) => changeTouchesRoots(change, project.directories, input.exists))
    ) {
      scopes.push({ kind: "project", projectRoot: resolve(project.projectRoot) });
    }
  }
  return scopes;
}

/**
 * Splits Cursor chats into those that can reload now and those still in a turn.
 *
 * Reloading a running chat cancels the turn, so a busy chat waits until it is
 * idle. Closed and non-Cursor chats are left alone.
 *
 * @param input - Live agents, scopes from {@link skillCatalogReloadScopes}, and a project-root lookup.
 * @returns Agent ids to reload now, and ids to reload once they are idle.
 */
export function selectCursorSkillReloads(input: {
  agents: readonly CursorSkillReloadAgent[];
  scopes: readonly CursorSkillReloadScope[];
  projectRootOf: (cwd: string) => string;
}): { now: string[]; later: string[] } {
  const userScope = input.scopes.some((scope) => scope.kind === "user");
  const projectRoots = new Set(
    input.scopes
      .filter(
        (scope): scope is { kind: "project"; projectRoot: string } => scope.kind === "project",
      )
      .map((scope) => resolve(scope.projectRoot)),
  );
  const now: string[] = [];
  const later: string[] = [];
  for (const agent of input.agents) {
    if (agent.internal || agent.provider !== "cursor" || agent.lifecycle === "closed") continue;
    if (!userScope) {
      const projectRoot = resolve(input.projectRootOf(agent.cwd));
      if (!projectRoots.has(projectRoot)) continue;
    }
    if (agent.busy || agent.lifecycle === "running" || agent.lifecycle === "initializing") {
      later.push(agent.agentId);
    } else {
      now.push(agent.agentId);
    }
  }
  return { now: dedupe(now), later: dedupe(later) };
}

/**
 * Trailing debounce. Each push resets the timer so a burst of writes reloads once.
 *
 * @param input - Delay, callback, and optional timers for tests.
 * @returns `push` to schedule and `cancel` to drop a pending fire.
 */
export function createSkillCatalogDebounce(input: {
  delayMs: number;
  onFire: () => void;
  scheduleTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
}): { push: () => void; cancel: () => void } {
  const scheduleTimeout =
    input.scheduleTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancelTimeout = input.cancelTimeout ?? ((handle) => clearTimeout(handle));
  let handle: ReturnType<typeof setTimeout> | null = null;
  return {
    push() {
      if (handle !== null) cancelTimeout(handle);
      handle = scheduleTimeout(() => {
        handle = null;
        input.onFire();
      }, input.delayMs);
    },
    cancel() {
      if (handle === null) return;
      cancelTimeout(handle);
      handle = null;
    },
  };
}

/**
 * Session surface that records draft workspaces and tells open composers to
 * refetch slash commands. The monitor implements it.
 */
export interface CursorSkillCatalog {
  /** Remember a draft chat directory so its project skill roots stay watched. */
  noteWorkspace(cwd: string): void;
  /** Subscribe to a catalog change that has already been applied on disk. */
  subscribe(listener: () => void): () => void;
}

function skillDirectories(
  base: string,
  thirdPartyExtensibility: boolean,
  includeBuiltin: boolean,
): string[] {
  const sources = CURSOR_ACP_SKILL_SOURCES.filter(
    (source) => thirdPartyExtensibility || !source.thirdParty,
  );
  const rows = includeBuiltin ? [...sources, CURSOR_ACP_BUILTIN_SKILL] : sources;
  return rows.map((source) => join(base, source.configDir, source.subdir));
}

function changeTouchesRoots(
  change: SkillCatalogChange,
  roots: readonly string[],
  exists: (path: string) => boolean,
): boolean {
  if (
    shouldReloadCursorSkillCatalog({
      changedPath: change.path,
      changeType: change.type,
      roots,
    })
  ) {
    return true;
  }
  if (change.type === "delete") {
    return shouldReloadAfterCatalogAncestorRemoved({ removedPath: change.path, roots });
  }
  return shouldReloadAfterCatalogAncestorAppeared({
    appearedPath: change.path,
    roots,
    exists,
  });
}

function watchForRoot(
  root: string,
  exists: (path: string) => boolean,
):
  | { kind: "recursive"; directory: string }
  | { kind: "shallow"; directory: string; expectChild: string }
  | null {
  let current = resolve(root);
  let child: string | null = null;
  const filesystemRoot = parse(current).root;
  for (;;) {
    if (exists(current)) {
      if (child === null) return { kind: "recursive", directory: current };
      if (current === filesystemRoot) return null;
      return { kind: "shallow", directory: current, expectChild: child };
    }
    const parent = dirname(current);
    if (parent === current) return null;
    child = basename(current);
    current = parent;
  }
}

function collapseParents(directories: readonly string[]): string[] {
  const unique = dedupe(directories.map((directory) => resolve(directory))).sort();
  return unique.filter(
    (directory) => !unique.some((other) => other !== directory && isSameOrInside(other, directory)),
  );
}

function dedupeShallow(entries: readonly SkillCatalogShallowWatch[]): SkillCatalogShallowWatch[] {
  const seen = new Set<string>();
  const result: SkillCatalogShallowWatch[] = [];
  for (const entry of entries) {
    const directory = resolve(entry.directory);
    const key = `${directory}${sep}${entry.expectChild}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ directory, expectChild: entry.expectChild });
  }
  return result.sort((left, right) =>
    `${left.directory}${sep}${left.expectChild}`.localeCompare(
      `${right.directory}${sep}${right.expectChild}`,
    ),
  );
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isSameOrInside(parent: string, child: string): boolean {
  const base = isAbsolute(parent) ? parent : resolve(parent);
  const target = isAbsolute(child) ? child : resolve(child);
  if (target === base) return true;
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`;
  return target.startsWith(prefix);
}
