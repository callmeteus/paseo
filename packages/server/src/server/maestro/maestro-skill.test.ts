import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { MaestroSkillService } from "./maestro-skill.js";

const homes: string[] = [];

async function makeHome(): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), "paseo-maestro-skill-"));
  homes.push(home);
  return home;
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

function fakeFetch(files: Record<string, string>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const target = String(url);
    if (target.includes("/commits/master")) {
      return new Response(JSON.stringify({ sha: "commit-1" }), { status: 200 });
    }
    if (target.includes("/git/trees/")) {
      return new Response(
        JSON.stringify({
          tree: Object.keys(files).map((filePath) => ({ path: filePath, type: "blob" })),
        }),
        { status: 200 },
      );
    }
    const match = target.match(/skills\/maestro\/(.+)$/);
    const content = match ? files[`skills/maestro/${match[1]}`] : undefined;
    if (content === undefined) return new Response("missing", { status: 404 });
    return new Response(content, { status: 200 });
  }) as typeof fetch;
}

describe("MaestroSkillService", () => {
  it("downloads the skill, records the commit, and builds a Paseo system prompt", async () => {
    const home = await makeHome();
    const service = new MaestroSkillService({
      paseoHome: home,
      logger: pino({ level: "silent" }),
      fetch: fakeFetch({
        "skills/maestro/SKILL.md": "# Maestro\n\nYou orchestrate.\n",
        "skills/maestro/references/router.md": "Router notes",
      }),
    });

    const status = await service.refresh();
    expect(status.installed).toBe(true);
    expect(status.commit).toBe("commit-1");
    expect(await readFile(path.join(service.skillDirectory, "SKILL.md"), "utf8")).toContain(
      "You orchestrate.",
    );
    expect(
      await readFile(path.join(service.skillDirectory, "references", "router.md"), "utf8"),
    ).toBe("Router notes");

    const prompt = await service.systemPrompt({ scope: "all", cwd: "/workspace" });
    expect(prompt).toContain("You orchestrate.");
    expect(prompt).toContain("todos os workspaces");
    expect(prompt).toContain("create_agent");
  });

  it("keeps the local copy when GitHub fails", async () => {
    const home = await makeHome();
    const service = new MaestroSkillService({
      paseoHome: home,
      logger: pino({ level: "silent" }),
      fetch: (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
    });

    const status = await service.refresh();
    expect(status.installed).toBe(false);
    expect(status.error).toContain("offline");
    const prompt = await service.systemPrompt({ scope: "workspace", cwd: "/workspace" });
    expect(prompt).toContain("orquestrador");
  });
});
