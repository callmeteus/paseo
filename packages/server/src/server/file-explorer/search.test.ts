import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { searchWorkspaceFiles } from "./search.js";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "paseo-search-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await writeFile(path.join(root, "README.md"), "# Paseo\nremote access notes\n");
  await writeFile(path.join(root, "src", "index.ts"), "export const remoteAccess = true;\n");
  await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "remoteAccess\n");
  await writeFile(path.join(root, "binary.bin"), Buffer.from([0, 1, 2, 3]));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("searchWorkspaceFiles", () => {
  it("matches file names and ignores dependency directories", async () => {
    const result = await searchWorkspaceFiles({ root, query: "index", mode: "name" });
    expect(result.matches.map((match) => match.path).sort()).toEqual(["src/index.ts"]);
    expect(result.truncated).toBe(false);
  });

  it("matches content with line and preview", async () => {
    const result = await searchWorkspaceFiles({
      root,
      query: "remote",
      mode: "content",
    });
    expect(result.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/index.ts",
          line: 1,
          column: 14,
          preview: "export const remoteAccess = true;",
        }),
        expect.objectContaining({ path: "README.md", line: 2 }),
      ]),
    );
  });

  it("is case sensitive when asked", async () => {
    const result = await searchWorkspaceFiles({
      root,
      query: "remoteAccess",
      mode: "content",
      caseSensitive: true,
    });
    expect(result.matches.some((match) => match.path === "src/index.ts")).toBe(true);
    expect(result.matches.some((match) => match.path === "README.md")).toBe(false);
  });

  it("never searches outside the workspace", async () => {
    await expect(
      searchWorkspaceFiles({ root, relativePath: "..", query: "x", mode: "name" }),
    ).rejects.toThrow("inside the workspace");
  });

  it("caps results and flags truncation", async () => {
    const result = await searchWorkspaceFiles({
      root,
      query: "e",
      mode: "name",
      maxResults: 1,
    });
    expect(result.matches).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });
});
