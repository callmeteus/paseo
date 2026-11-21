import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { AgentStorage, parseStoredAgentRecord } from "../agent-storage.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { createRestartRecovery } from "./index.js";

function stored(root: string, id: string, extra: Record<string, unknown> = {}) {
  return parseStoredAgentRecord({
    id,
    lastStatus: "running",
    provider: "codex",
    cwd: root,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra,
  });
}

test("recovery saves intent before normalization, clears it before dispatch, and isolates agents", async () => {
  const root = await mkdtemp(join(tmpdir(), "restart-recovery-"));
  try {
    const storage = new AgentStorage(root, createTestLogger());
    for (const id of ["broken", "stuck", "working", "initializing"]) {
      await storage.upsert(
        stored(root, id, { lastStatus: id === "initializing" ? "initializing" : "running" }),
      );
    }
    await storage.upsert(stored(root, "idle", { lastStatus: "idle" }));

    const dispatched: string[] = [];
    const recovery = createRestartRecovery({
      storage,
      settings: () => ({ enabled: true, prompt: "Continue verbatim.\n" }),
      eligible: async () => true,
      dispatch: async (id, prompt) => {
        expect((await storage.get(id))?.resumeOnStartup).toBe(false);
        if (id === "broken") throw new Error("unavailable");
        if (id === "stuck") return new Promise(() => {});
        dispatched.push(id + prompt);
      },
      report: () => {},
    });

    await recovery.prepareStartup();
    expect((await storage.get("working"))?.resumeOnStartup).toBe(true);
    expect((await storage.get("working"))?.lastStatus).toBe("closed");
    expect((await storage.get("idle"))?.resumeOnStartup).toBeUndefined();

    recovery.resumePending();
    const signal = new AbortController().signal;
    await recovery.waitForResume("broken", signal);
    await recovery.waitForResume("working", signal);
    await recovery.waitForResume("idle", signal);
    expect(dispatched).toEqual(["workingContinue verbatim.\n"]);

    const aborted = new AbortController();
    aborted.abort();
    await expect(recovery.waitForResume("stuck", aborted.signal)).rejects.toBeDefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("opt-out consumes pending intent and excludes archived, private, owned and archived-workspace agents", async () => {
  const root = await mkdtemp(join(tmpdir(), "restart-recovery-"));
  try {
    const storage = new AgentStorage(root, createTestLogger());
    for (const extra of [
      { id: "running" },
      { id: "archived", archivedAt: "today" },
      { id: "private", internal: true },
      { id: "owned", owner: { kind: "daemon", daemonId: "hub", executionId: "run" } },
      { id: "workspace", workspaceId: "archived" },
    ]) {
      await storage.upsert(stored(root, extra.id as string, extra));
    }

    let enabled = true;
    const dispatched: string[] = [];
    const recovery = createRestartRecovery({
      storage,
      settings: () => ({ enabled, prompt: "Resume working." }),
      eligible: async (record) => record.workspaceId !== "archived",
      dispatch: async (id) => {
        dispatched.push(id);
      },
      report: () => {},
    });

    await recovery.captureRunningAgents();
    expect((await storage.get("running"))?.resumeOnStartup).toBe(true);
    enabled = false;
    await recovery.prepareStartup();
    enabled = true;
    recovery.resumePending();
    expect(dispatched).toEqual([]);
    expect((await storage.list()).every((record) => !record.resumeOnStartup)).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
