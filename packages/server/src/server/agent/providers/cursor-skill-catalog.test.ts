import { join, resolve, sep } from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  createSkillCatalogDebounce,
  cursorProjectRoot,
  cursorProjectSkillRoots,
  cursorSkillCatalogRoots,
  cursorUserSkillRoots,
  planSkillCatalogWatches,
  selectCursorSkillReloads,
  shouldReloadCursorSkillCatalog,
  skillCatalogReloadScopes,
  type CursorSkillReloadAgent,
} from "./cursor-skill-catalog.js";

const home = resolve("/home/gio");
const parent = resolve("/work/luckymaker-workspace");
const nested = join(parent, "even7-sre");

function gitExists(paths: readonly string[]): (path: string) => boolean {
  const present = new Set(paths);
  return (path) => present.has(path);
}

function agent(overrides: Partial<CursorSkillReloadAgent> = {}): CursorSkillReloadAgent {
  return {
    agentId: "agent-1",
    provider: "cursor",
    cwd: join(parent, "packages"),
    lifecycle: "idle",
    busy: false,
    ...overrides,
  };
}

describe("cursorProjectRoot", () => {
  const exists = gitExists([join(parent, ".git"), join(nested, ".git")]);

  test("uses the nearest git directory and does not enter a nested repo", () => {
    expect(cursorProjectRoot(parent, exists)).toBe(parent);
    expect(cursorProjectRoot(join(parent, "packages"), exists)).toBe(parent);
    expect(cursorProjectRoot(join(nested, "src"), exists)).toBe(nested);
  });

  test("keeps the start directory when nothing above it is a git repo", () => {
    expect(cursorProjectRoot(join(parent, "loose"), gitExists([]))).toBe(join(parent, "loose"));
  });
});

describe("cursor skill directories", () => {
  test("matches the ACP skill roots, including third-party folders and builtin skills", () => {
    expect(cursorProjectSkillRoots(parent)).toEqual([
      join(parent, ".cursor", "skills"),
      join(parent, ".claude", "skills"),
      join(parent, ".codex", "skills"),
      join(parent, ".grok", "skills"),
      join(parent, ".agents", "skills"),
    ]);
    expect(cursorUserSkillRoots(home)).toEqual([
      join(home, ".cursor", "skills"),
      join(home, ".claude", "skills"),
      join(home, ".codex", "skills"),
      join(home, ".grok", "skills"),
      join(home, ".agents", "skills"),
      join(home, ".cursor", "skills-cursor"),
    ]);
  });

  test("drops third-party folders when ACP extensibility is off", () => {
    expect(cursorProjectSkillRoots(parent, false)).toEqual([
      join(parent, ".cursor", "skills"),
      join(parent, ".agents", "skills"),
    ]);
  });

  test("does not treat a nested repo skill folder as a root of the parent workspace", () => {
    const roots = cursorSkillCatalogRoots({ projectRoot: parent, homeDirectory: home });
    expect(roots).toContain(join(parent, ".cursor", "skills"));
    expect(roots).not.toContain(join(nested, ".cursor", "skills"));
  });
});

describe("planSkillCatalogWatches", () => {
  test("watches an existing skill root recursively and a missing one from its nearest parent", () => {
    const skills = join(parent, ".cursor", "skills");
    const claude = join(parent, ".claude", "skills");
    const exists = gitExists([parent, skills]);
    expect(
      planSkillCatalogWatches({
        roots: [skills, claude],
        exists,
      }),
    ).toEqual({
      recursive: [skills],
      shallow: [{ directory: parent, expectChild: ".claude" }],
    });
  });

  test("does not watch the filesystem root when that is the only existing ancestor", () => {
    const root = join(sep, "missing-workspace", ".cursor", "skills");
    const filesystemRoot = resolve(sep);
    expect(
      planSkillCatalogWatches({
        roots: [root],
        exists: (path) => resolve(path) === filesystemRoot,
      }),
    ).toEqual({
      recursive: [],
      shallow: [],
    });
  });
});

describe("skill catalog reload rules", () => {
  const roots = [join(parent, ".cursor", "skills")];
  const skill = join(parent, ".cursor", "skills", "manutencao", "SKILL.md");

  test("reloads for SKILL.md creates, edits, and deletes", () => {
    for (const changeType of ["create", "update", "delete"] as const) {
      expect(shouldReloadCursorSkillCatalog({ changedPath: skill, changeType, roots })).toBe(true);
    }
  });

  test("ignores edits of other files and changes outside the catalog", () => {
    expect(
      shouldReloadCursorSkillCatalog({
        changedPath: join(parent, ".cursor", "skills", "manutencao", "notes.md"),
        changeType: "update",
        roots,
      }),
    ).toBe(false);
    expect(
      shouldReloadCursorSkillCatalog({
        changedPath: join(nested, ".cursor", "skills", "manutencao", "SKILL.md"),
        changeType: "create",
        roots,
      }),
    ).toBe(false);
  });

  test("reloads when the skill directory is created or removed", () => {
    const directory = join(parent, ".cursor", "skills", "manutencao");
    expect(
      shouldReloadCursorSkillCatalog({ changedPath: directory, changeType: "create", roots }),
    ).toBe(true);
    expect(
      shouldReloadCursorSkillCatalog({ changedPath: directory, changeType: "delete", roots }),
    ).toBe(true);
  });

  test("treats a parent appearing with the skill root already on disk as a reload", () => {
    const skills = join(parent, ".cursor", "skills");
    const scopes = skillCatalogReloadScopes({
      changes: [{ path: join(parent, ".cursor"), type: "create" }],
      userRoots: [],
      projects: [{ projectRoot: parent, directories: [skills] }],
      exists: gitExists([skills]),
    });
    expect(scopes).toEqual([{ kind: "project", projectRoot: parent }]);
  });

  test("does not reload when only the ancestor appeared and the skill root is still missing", () => {
    expect(
      skillCatalogReloadScopes({
        changes: [{ path: join(parent, ".cursor"), type: "create" }],
        userRoots: [],
        projects: [{ projectRoot: parent, directories: [join(parent, ".cursor", "skills")] }],
        exists: () => false,
      }),
    ).toEqual([]);
  });

  test("a user-home skill change covers every project", () => {
    expect(
      skillCatalogReloadScopes({
        changes: [
          { path: join(home, ".cursor", "skills", "manutencao", "SKILL.md"), type: "update" },
        ],
        userRoots: cursorUserSkillRoots(home),
        projects: [{ projectRoot: parent, directories: cursorProjectSkillRoots(parent) }],
        exists: () => true,
      }),
    ).toEqual([{ kind: "user" }]);
  });
});

describe("selectCursorSkillReloads", () => {
  const projectRootOf = (cwd: string) => cursorProjectRoot(cwd, gitExists([join(parent, ".git")]));

  test("reloads an idle Cursor chat now and defers one that is in a turn", () => {
    expect(
      selectCursorSkillReloads({
        agents: [
          agent(),
          agent({ agentId: "busy", lifecycle: "running", busy: true }),
          agent({ agentId: "other", provider: "codex" }),
          agent({ agentId: "closed", lifecycle: "closed" }),
        ],
        scopes: [{ kind: "project", projectRoot: parent }],
        projectRootOf,
      }),
    ).toEqual({ now: ["agent-1"], later: ["busy"] });
  });

  test("a user-home scope reloads every Cursor chat, a project scope does not cross repos", () => {
    const other = resolve("/work/other");
    expect(
      selectCursorSkillReloads({
        agents: [agent(), agent({ agentId: "other", cwd: other })],
        scopes: [{ kind: "user" }],
        projectRootOf: (cwd) => cwd,
      }).now.sort(),
    ).toEqual(["agent-1", "other"]);
    expect(
      selectCursorSkillReloads({
        agents: [agent({ cwd: parent }), agent({ agentId: "other", cwd: other })],
        scopes: [{ kind: "project", projectRoot: parent }],
        projectRootOf: (cwd) => cwd,
      }),
    ).toEqual({ now: ["agent-1"], later: [] });
  });
});

describe("createSkillCatalogDebounce", () => {
  test("collapses a burst of pushes into one trailing call", () => {
    vi.useFakeTimers();
    const onFire = vi.fn();
    const debounce = createSkillCatalogDebounce({ delayMs: 400, onFire });
    debounce.push();
    debounce.push();
    vi.advanceTimersByTime(399);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledTimes(1);
    debounce.cancel();
    debounce.push();
    debounce.cancel();
    vi.advanceTimersByTime(400);
    expect(onFire).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
