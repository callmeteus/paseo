import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  CursorSkillCatalogMonitor,
  createNodeSkillCatalogWatcher,
  type CursorSkillCatalogAgentHost,
  type SkillCatalogChange,
  type SkillCatalogWatcher,
} from "./cursor-skill-catalog-monitor.js";
import type { CursorSkillReloadAgent } from "./cursor-skill-catalog.js";

const roots = new Set<string>();

afterEach(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
  roots.clear();
});

class FakeWatcher implements SkillCatalogWatcher {
  readonly present = new Set<string>();
  readonly recursive: Array<{
    directory: string;
    onEvents: (events: SkillCatalogChange[]) => void;
  }> = [];
  readonly shallow: Array<{
    directory: string;
    onChild: (name: string | null) => void;
  }> = [];

  exists(path: string): boolean {
    return this.present.has(resolve(path));
  }

  async watchRecursive(directory: string, onEvents: (events: SkillCatalogChange[]) => void) {
    const entry = { directory: resolve(directory), onEvents };
    this.recursive.push(entry);
    return {
      close: () => {
        const index = this.recursive.indexOf(entry);
        if (index >= 0) this.recursive.splice(index, 1);
      },
    };
  }

  watchShallow(
    directory: string,
    handlers: { onChild(name: string | null): void; onError(): void },
  ) {
    const entry = { directory: resolve(directory), onChild: handlers.onChild };
    this.shallow.push(entry);
    return {
      close: () => {
        const index = this.shallow.indexOf(entry);
        if (index >= 0) this.shallow.splice(index, 1);
      },
    };
  }
}

function host(agents: CursorSkillReloadAgent[]): CursorSkillCatalogAgentHost & {
  reloaded: string[];
  emitIdle(agentId: string): void;
} {
  let onState: (event: {
    type: "agent_state";
    agent: {
      id: string;
      provider: string;
      cwd: string;
      lifecycle: CursorSkillReloadAgent["lifecycle"];
      internal?: boolean;
    };
  }) => void = () => {};
  const reloaded: string[] = [];
  return {
    reloaded,
    listCursorAgents: () => agents,
    reload: async (agentId) => {
      reloaded.push(agentId);
    },
    subscribe(listener) {
      onState = listener;
      return () => {
        onState = () => {};
      };
    },
    emitIdle(agentId) {
      const agent = agents.find((candidate) => candidate.agentId === agentId);
      if (!agent) return;
      onState({
        type: "agent_state",
        agent: {
          id: agent.agentId,
          provider: agent.provider,
          cwd: agent.cwd,
          lifecycle: agent.lifecycle,
          internal: agent.internal,
        },
      });
    },
  };
}

describe("CursorSkillCatalogMonitor", () => {
  test("reloads an idle chat once when a missing skill root appears, and defers a busy chat", async () => {
    const home = resolve("/home/gio");
    const project = resolve("/work/luckymaker-workspace");
    const watcher = new FakeWatcher();
    watcher.present.add(home);
    watcher.present.add(project);
    watcher.present.add(join(project, ".git"));
    const idle = host([
      {
        agentId: "idle",
        provider: "cursor",
        cwd: project,
        lifecycle: "idle",
        busy: false,
      },
      {
        agentId: "busy",
        provider: "cursor",
        cwd: project,
        lifecycle: "running",
        busy: true,
      },
    ]);
    const notified: number[] = [];
    const monitor = new CursorSkillCatalogMonitor({
      homeDirectory: home,
      agents: idle,
      watcher,
      debounceMs: 20,
    });
    monitor.subscribe(() => {
      notified.push(idle.reloaded.length);
    });
    await monitor.start();
    expect(watcher.shallow.some((entry) => entry.directory === project)).toBe(true);
    expect(watcher.recursive).toHaveLength(0);

    watcher.present.add(join(project, ".cursor", "skills"));
    const projectWatch = watcher.shallow.find((entry) => entry.directory === project);
    projectWatch?.onChild(".cursor");
    projectWatch?.onChild("README.md");

    await expect.poll(() => idle.reloaded).toEqual(["idle"]);
    expect(notified).toEqual([1]);

    const busy = idle.listCursorAgents().find((candidate) => candidate.agentId === "busy");
    if (!busy) throw new Error("missing busy agent");
    busy.lifecycle = "idle";
    busy.busy = false;
    idle.emitIdle("busy");
    await expect.poll(() => idle.reloaded).toEqual(["idle", "busy"]);
    await monitor.stop();
  });

  test("an edit and a delete of SKILL.md each reload, and a nested repo skill does not", async () => {
    const home = resolve("/home/gio");
    const project = resolve("/work/luckymaker-workspace");
    const skills = join(project, ".cursor", "skills");
    const watcher = new FakeWatcher();
    for (const path of [home, project, join(project, ".git"), skills]) watcher.present.add(path);
    const agents = host([
      {
        agentId: "chat",
        provider: "cursor",
        cwd: join(project, "packages"),
        lifecycle: "idle",
        busy: false,
      },
    ]);
    const monitor = new CursorSkillCatalogMonitor({
      homeDirectory: home,
      agents,
      watcher,
      debounceMs: 20,
    });
    await monitor.start();
    expect(watcher.recursive.map((entry) => entry.directory)).toContain(skills);

    const skill = join(skills, "manutencao", "SKILL.md");
    const watch = watcher.recursive.find((entry) => entry.directory === skills);
    watch?.onEvents([
      { path: skill, type: "update" },
      { path: skill, type: "update" },
    ]);
    await expect.poll(() => agents.reloaded).toEqual(["chat"]);

    watch?.onEvents([
      {
        path: join(project, "even7-sre", ".cursor", "skills", "manutencao", "SKILL.md"),
        type: "create",
      },
    ]);
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 60));
    expect(agents.reloaded).toEqual(["chat"]);

    watch?.onEvents([{ path: skill, type: "delete" }]);
    await expect.poll(() => agents.reloaded).toEqual(["chat", "chat"]);
    await monitor.stop();
  });
});

describe("createNodeSkillCatalogWatcher", () => {
  test("sees a SKILL.md created after the watch starts", async () => {
    const root = await mkdtemp(join(tmpdir(), "paseo-skill-catalog-"));
    roots.add(root);
    const home = join(root, "home");
    const project = join(root, "project");
    const skills = join(project, ".cursor", "skills");
    await mkdir(home, { recursive: true });
    await mkdir(skills, { recursive: true });
    await writeFile(join(project, ".git"), "gitdir: /unused\n");
    const agents = host([
      {
        agentId: "chat",
        provider: "cursor",
        cwd: project,
        lifecycle: "idle",
        busy: false,
      },
    ]);
    const monitor = new CursorSkillCatalogMonitor({
      homeDirectory: home,
      agents,
      watcher: createNodeSkillCatalogWatcher(),
      debounceMs: 30,
    });
    await monitor.start();
    const skillDir = join(skills, "manutencao");
    await mkdir(skillDir);
    const skill = join(skillDir, "SKILL.md");
    await writeFile(skill, "---\nname: Manutencao\n---\n");
    await expect.poll(() => agents.reloaded.length, { timeout: 3000 }).toBeGreaterThan(0);
    const afterCreate = agents.reloaded.length;

    await writeFile(skill, "---\nname: Manutencao\n---\nupdated\n");
    await expect.poll(() => agents.reloaded.length, { timeout: 3000 }).toBeGreaterThan(afterCreate);
    const afterEdit = agents.reloaded.length;

    await rm(skill);
    await expect.poll(() => agents.reloaded.length, { timeout: 3000 }).toBeGreaterThan(afterEdit);
    expect(agents.reloaded.every((agentId) => agentId === "chat")).toBe(true);
    await monitor.stop();
  });
});
