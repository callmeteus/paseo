import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendTasteBlock,
  composeTasteBlock,
  findTasteProjectRoot,
  readTasteLearning,
  readTasteSnapshot,
  shouldInjectTaste,
  TASTE_BLOCK_START,
  type TasteFileRecord,
} from "./taste.js";

function writeTaste(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function writeJson(root: string, relativePath: string, value: unknown): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

function record(overrides: Partial<TasteFileRecord> = {}): TasteFileRecord {
  return {
    scope: "project",
    path: "/repo/.commandcode/taste/taste.md",
    relativePath: ".commandcode/taste/taste.md",
    bytes: 10,
    modifiedAt: "2026-10-01T00:00:00.000Z",
    content: "- Prefer early returns.",
    ...overrides,
  };
}

describe("Command Code taste discovery", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "commandcode-taste-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("walks up from a nested directory to the project taste root", async () => {
    const project = join(home, "project");
    writeTaste(project, ".commandcode/taste/taste.md", "root");
    const nested = join(project, "packages", "app");
    mkdirSync(nested, { recursive: true });

    expect(await findTasteProjectRoot(nested, { HOME: join(home, "user") })).toBe(project);
  });

  it("never adopts the global profile as a project root", async () => {
    writeTaste(home, ".commandcode/taste/taste.md", "global-ish");
    const project = join(home, "projects", "app");
    mkdirSync(project, { recursive: true });

    expect(await findTasteProjectRoot(project, { HOME: home })).toBeNull();
  });

  it("stops at a repo root instead of adopting taste from a parent project", async () => {
    writeTaste(home, ".commandcode/taste/taste.md", "parent");
    const repo = join(home, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    const nested = join(repo, "src");
    mkdirSync(nested, { recursive: true });

    expect(await findTasteProjectRoot(nested, { HOME: join(home, "user") })).toBeNull();
  });

  it("reads the root file first and categories in sorted order", async () => {
    writeTaste(home, ".commandcode/taste/taste.md", "root");
    writeTaste(home, ".commandcode/taste/typescript/taste.md", "ts");
    writeTaste(home, ".commandcode/taste/architecture/taste.md", "arch");

    const snapshot = await readTasteSnapshot(home, false);

    expect(snapshot.projectRoot).toBe(home);
    expect(snapshot.files.map((file) => file.relativePath)).toEqual([
      ".commandcode/taste/taste.md",
      ".commandcode/taste/architecture/taste.md",
      ".commandcode/taste/typescript/taste.md",
    ]);
  });

  it("skips empty files and missing directories", async () => {
    writeTaste(home, ".commandcode/taste/taste.md", "   \n");
    writeTaste(home, ".commandcode/taste/cli/taste.md", "cli");

    const snapshot = await readTasteSnapshot(home, false);

    expect(snapshot.files.map((file) => file.relativePath)).toEqual([
      ".commandcode/taste/cli/taste.md",
    ]);
  });

  it("adds global packages with a home-relative label", async () => {
    writeTaste(home, "project/.commandcode/taste/taste.md", "project");
    writeTaste(home, "global/.commandcode/taste/cli/taste.md", "global cli");

    const snapshot = await readTasteSnapshot(join(home, "project"), true, {
      HOME: join(home, "global"),
    } as NodeJS.ProcessEnv);

    expect(snapshot.files.map((file) => file.relativePath)).toEqual([
      ".commandcode/taste/taste.md",
      "~/.commandcode/taste/cli/taste.md",
    ]);
  });
});

describe("Command Code taste learning state", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "commandcode-taste-learning-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const env = (): NodeJS.ProcessEnv =>
    ({ HOME: join(home, "user"), USERPROFILE: join(home, "user") }) as NodeJS.ProcessEnv;

  it("defaults to on when nothing sets it", async () => {
    expect(await readTasteLearning(home, env())).toEqual({ enabled: true, source: null });
  });

  it("prefers settings.local.json over settings.json and the user config", async () => {
    writeJson(home, ".commandcode/settings.local.json", { tasteLearning: false });
    writeJson(home, ".commandcode/settings.json", { tasteLearning: true });
    writeJson(home, "user/.commandcode/config.json", { tasteLearning: true });

    expect(await readTasteLearning(home, env())).toEqual({
      enabled: false,
      source: ".commandcode/settings.local.json",
    });
  });

  it("falls through a file without the key", async () => {
    writeJson(home, ".commandcode/settings.local.json", { theme: "dark" });
    writeJson(home, ".commandcode/settings.json", { tasteLearning: false });

    expect(await readTasteLearning(home, env())).toEqual({
      enabled: false,
      source: ".commandcode/settings.json",
    });
  });

  it("uses the user config when the project files are silent", async () => {
    writeJson(home, "user/.commandcode/config.json", { tasteLearning: false });

    expect(await readTasteLearning(home, env())).toEqual({
      enabled: false,
      source: "~/.commandcode/config.json",
    });
  });
});

describe("Command Code taste prompt block", () => {
  it("wraps files with scope labels and the start marker", () => {
    const composed = composeTasteBlock(
      [record(), record({ scope: "global", relativePath: "~/.commandcode/taste/taste.md" })],
      32000,
    );

    expect(composed.block.startsWith(TASTE_BLOCK_START)).toBe(true);
    expect(composed.block).toContain("--- project: .commandcode/taste/taste.md ---");
    expect(composed.block).toContain("--- global: ~/.commandcode/taste/taste.md ---");
    expect(composed.block).toContain("- Prefer early returns.");
    expect(composed.truncated).toBe(false);
  });

  it("truncates past the cap and marks the block", () => {
    const composed = composeTasteBlock([record({ content: "x".repeat(500) })], 400);

    expect(composed.truncated).toBe(true);
    expect(composed.block).toContain("… (truncated)");
    expect(composed.block.length).toBeLessThanOrEqual(400 + 40);
  });

  it("returns an empty block when there is nothing to inject", () => {
    expect(composeTasteBlock([], 32000).block).toBe("");
    expect(composeTasteBlock([record()], 0).block).toBe("");
  });

  it("appends once and preserves an existing prompt", () => {
    const block = composeTasteBlock([record()], 32000).block;

    expect(appendTasteBlock(undefined, block)).toBe(block);
    expect(appendTasteBlock("You are a reviewer.", block)).toBe(`You are a reviewer.\n\n${block}`);

    const once = appendTasteBlock("You are a reviewer.", block);
    expect(appendTasteBlock(once, block)).toBe(once);
    expect(appendTasteBlock(undefined, "")).toBeUndefined();
  });

  it("only injects into providers that consume prompts", () => {
    expect(shouldInjectTaste("claude", true)).toBe(true);
    expect(shouldInjectTaste("zai", true)).toBe(true);
    expect(shouldInjectTaste("claude", false)).toBe(false);
    expect(shouldInjectTaste("commandcode", true)).toBe(false);
  });
});
