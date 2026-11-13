import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { listGlobalSkills } from "./global-skills.js";

const homes: string[] = [];

async function createHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "paseo-global-skills-"));
  homes.push(home);
  return home;
}

async function writeSkill(home: string, relativeDir: string, contents: string): Promise<string> {
  const dir = join(home, relativeDir);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), contents, "utf8");
  return dir;
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("listGlobalSkills", () => {
  test("lists every user skill root and merges duplicates by name", async () => {
    const home = await createHome();
    const claudeDir = await writeSkill(
      home,
      join(".claude", "skills", "review"),
      [
        "---",
        "name: code-review",
        'description: "Review code changes"',
        "---",
        "",
        "# Review",
      ].join("\n"),
    );
    const agentsDir = await writeSkill(
      home,
      join(".agents", "skills", "code-review"),
      ["---", "description: Agents copy", "---"].join("\n"),
    );
    const piDir = await writeSkill(
      home,
      join(".pi", "agent", "skills", "pi-only"),
      ["---", "name: pi-only", "description: Pi only", "---"].join("\n"),
    );
    const openCodeDir = await writeSkill(
      home,
      join(".config", "opencode", "skills", "opencode-only"),
      ["---", "name: opencode-only", "---"].join("\n"),
    );
    await mkdir(join(home, ".cursor", "skills", "no-skill-file"), { recursive: true });

    const skills = await listGlobalSkills(home, new Set(["code-review"]));

    expect(skills).toEqual([
      {
        name: "code-review",
        sources: ["claude", "agents"],
        paths: [claudeDir, agentsDir],
        description: "Review code changes",
        managed: true,
      },
      {
        name: "opencode-only",
        sources: ["opencode"],
        paths: [openCodeDir],
        description: null,
        managed: false,
      },
      {
        name: "pi-only",
        sources: ["pi"],
        paths: [piDir],
        description: "Pi only",
        managed: false,
      },
    ]);
  });

  test("uses the directory name when frontmatter has no name", async () => {
    const home = await createHome();
    const dir = await writeSkill(
      home,
      join(".codex", "skills", "from-dir"),
      "No frontmatter here.",
    );

    const skills = await listGlobalSkills(home, new Set());
    expect(skills).toEqual([
      {
        name: "from-dir",
        sources: ["codex"],
        paths: [dir],
        description: null,
        managed: false,
      },
    ]);
  });

  test("returns an empty list when no skill roots exist", async () => {
    const home = await createHome();
    await expect(listGlobalSkills(home, new Set())).resolves.toEqual([]);
  });
});
