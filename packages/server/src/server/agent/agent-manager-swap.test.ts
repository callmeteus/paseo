import { describe, expect, it, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentStorage } from "./agent-storage.js";
import { AgentManager } from "./agent-manager.js";

describe("AgentManager.swapProvider", () => {
  let dir: string;
  let storage: AgentStorage;
  let manager: AgentManager;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "paseo-swap-mgr-"));
    storage = new AgentStorage(dir, createTestLogger());
    manager = new AgentManager({ registry: storage, logger: createTestLogger() });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("swaps provider and archives original", async () => {
    await storage.upsert({
      id: "agent-1",
      provider: "opencode",
      cwd: "/tmp/project",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      labels: {},
      lastStatus: "closed",
      config: { model: "gpt-5.1" },
    } as unknown as Parameters<typeof storage.upsert>[0]);

    const result = await manager.swapProvider("agent-1", "claude", "claude-sonnet-4");
    expect(result.previousAgentId).toBe("agent-1");
    const ported = await storage.get(result.newAgentId);
    expect(ported?.provider).toBe("claude");
  });

  it("throws when storage unavailable", async () => {
    const m = new AgentManager({ logger: createTestLogger() });
    await expect(m.swapProvider("x", "claude", null)).rejects.toThrow();
  });
});
