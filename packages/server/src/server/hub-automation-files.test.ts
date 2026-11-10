import { mkdtemp, mkdir, readFile, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeHubAutomationFiles } from "./hub-automation-files.js";

describe("hub automation files", () => {
  it("writes prompt files under the run directory and refuses a path that leaves it", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "paseo-run-"));
    await writeHubAutomationFiles(workspace, [
      { path: "partials/falar.md", content: "oi\n" },
      { path: "regras/ajuste-de-saldo.md", content: "regra\n" },
    ]);
    expect(
      await readFile(path.join(workspace, ".paseo/automations/partials/falar.md"), "utf8"),
    ).toBe("oi\n");
    await expect(
      writeHubAutomationFiles(workspace, [{ path: "../segredo.md", content: "nope" }]),
    ).rejects.toThrow(/must not contain/u);
  });

  it("refuses a symlink that leaves the automations directory", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "paseo-run-"));
    const outside = await mkdtemp(path.join(tmpdir(), "paseo-outside-"));
    const root = path.join(workspace, ".paseo", "automations");
    await mkdir(root, { recursive: true });
    await symlink(outside, path.join(root, "partials"));
    await expect(
      writeHubAutomationFiles(workspace, [{ path: "partials/falar.md", content: "oi\n" }]),
    ).rejects.toThrow(/escapes/u);
    expect(await readdir(outside)).toEqual([]);
  });
});
