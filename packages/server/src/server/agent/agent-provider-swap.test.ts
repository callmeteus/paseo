import { describe, expect, it, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentStorage } from "./agent-storage.js";
import {
  buildPortedTimelineRows,
  buildPortingTranscript,
  swapAgentProvider,
  SwapProviderError,
} from "./agent-provider-swap.js";

describe("swapAgentProvider", () => {
  let dir: string;
  let storage: AgentStorage;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "paseo-swap-"));
    storage = new AgentStorage(dir, createTestLogger());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function seed() {
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
  }

  it("ports an agent to a new provider (happy path)", async () => {
    await seed();
    const result = await swapAgentProvider({
      storage,
      agentId: "agent-1",
      targetProvider: "claude",
      targetModel: "claude-sonnet-4",
    });
    expect(result.previousAgentId).toBe("agent-1");
    expect(result.newAgentId).not.toBe("agent-1");

    const original = await storage.get("agent-1");
    expect(original?.archivedAt).toBeTruthy();
    expect(original?.migratedTo?.agentId).toBe(result.newAgentId);

    const ported = await storage.get(result.newAgentId);
    expect(ported?.provider).toBe("claude");
    expect(ported?.config?.model).toBe("claude-sonnet-4");
    expect(ported?.migratedFrom?.provider).toBe("opencode");
    expect(ported?.migratedFrom?.portedAt).toBeTruthy();
    expect(original?.migratedTo?.portedAt).toBeTruthy();
  });

  it("embeds the previous conversation in the target system prompt (happy path)", async () => {
    await seed();
    const result = await swapAgentProvider({
      storage,
      agentId: "agent-1",
      targetProvider: "claude",
      targetModel: "claude-sonnet-4",
      previousItems: [
        { type: "user_message", text: "Add a logout button" },
        { type: "assistant_message", text: "I added it to the header." },
      ],
    });

    const ported = await storage.get(result.newAgentId);
    expect(ported?.config?.systemPrompt).toContain("Add a logout button");
    expect(ported?.config?.systemPrompt).toContain("I added it to the header.");
    expect(ported?.config?.systemPrompt).toContain("ported from opencode");
  });

  it("keeps an existing system prompt above the ported transcript (happy path)", async () => {
    await storage.upsert({
      id: "agent-1",
      provider: "opencode",
      cwd: "/tmp/project",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      labels: {},
      lastStatus: "closed",
      config: { model: "gpt-5.1", systemPrompt: "You are a careful reviewer." },
    } as unknown as Parameters<typeof storage.upsert>[0]);

    const result = await swapAgentProvider({
      storage,
      agentId: "agent-1",
      targetProvider: "claude",
      targetModel: null,
      previousItems: [{ type: "user_message", text: "Hello" }],
    });

    const ported = await storage.get(result.newAgentId);
    expect(ported?.config?.systemPrompt).toContain("You are a careful reviewer.");
    expect(ported?.config?.systemPrompt).toContain("Hello");
  });

  it("replaces the previous ported transcript instead of stacking another one", async () => {
    await storage.upsert({
      id: "agent-1",
      provider: "opencode",
      cwd: "/tmp/project",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      labels: {},
      lastStatus: "closed",
      config: {
        model: "gpt-5.1",
        systemPrompt:
          "You are a careful reviewer.\n\nThe following conversation was ported from cline. Continue it as if you had been the assistant.\n\nUser: old turn\n\nAssistant: old reply",
      },
    } as unknown as Parameters<typeof storage.upsert>[0]);

    const result = await swapAgentProvider({
      storage,
      agentId: "agent-1",
      targetProvider: "claude",
      targetModel: null,
      previousItems: [{ type: "user_message", text: "new turn" }],
    });

    const prompt = (await storage.get(result.newAgentId))?.config?.systemPrompt ?? "";
    expect(prompt).toContain("You are a careful reviewer.");
    expect(prompt).toContain("new turn");
    expect(prompt).not.toContain("old turn");
    expect(prompt.match(/was ported from/g)).toHaveLength(1);
  });

  it("caps the ported system prompt so providers accept it", async () => {
    await seed();
    const longHistory = Array.from({ length: 400 }, (_, index) => ({
      type: "user_message" as const,
      text: `message ${index} `.repeat(30),
    }));
    const result = await swapAgentProvider({
      storage,
      agentId: "agent-1",
      targetProvider: "claude",
      targetModel: null,
      previousItems: longHistory,
    });
    const prompt = (await storage.get(result.newAgentId))?.config?.systemPrompt ?? "";
    expect(prompt.length).toBeLessThanOrEqual(48_000);
    expect(prompt).toContain("ported from opencode");
  });

  it("does not inherit the source's outgoing port link", async () => {
    await storage.upsert({
      id: "agent-1",
      provider: "opencode",
      cwd: "/tmp/project",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      labels: {},
      lastStatus: "closed",
      config: { model: "gpt-5.1" },
      migratedTo: { provider: "kilo", agentId: "older-port" },
    } as unknown as Parameters<typeof storage.upsert>[0]);

    const result = await swapAgentProvider({
      storage,
      agentId: "agent-1",
      targetProvider: "claude",
      targetModel: null,
    });

    const ported = await storage.get(result.newAgentId);
    expect(ported?.migratedTo).toBeUndefined();
    expect(ported?.migratedFrom?.agentId).toBe("agent-1");
  });

  it("keeps the ported chat visible by carrying its last user message time", async () => {
    await seed();
    const result = await swapAgentProvider({
      storage,
      agentId: "agent-1",
      targetProvider: "claude",
      targetModel: null,
      portedTimeline: [
        {
          seq: 1,
          timestamp: "2026-01-01T10:00:00.000Z",
          item: { type: "user_message", text: "old prompt", messageId: "m1" },
        },
        {
          seq: 2,
          timestamp: "2026-01-01T10:05:00.000Z",
          item: { type: "assistant_message", text: "reply", messageId: "m2" },
        },
      ],
    });

    const ported = await storage.get(result.newAgentId);
    expect(ported?.lastUserMessageAt).toBe("2026-01-01T10:00:00.000Z");
  });

  it("throws when agent does not exist (sad path)", async () => {
    await expect(
      swapAgentProvider({
        storage,
        agentId: "missing",
        targetProvider: "claude",
        targetModel: null,
      }),
    ).rejects.toBeInstanceOf(SwapProviderError);
  });

  it("throws when target provider is empty (sad path)", async () => {
    await seed();
    await expect(
      swapAgentProvider({
        storage,
        agentId: "agent-1",
        targetProvider: "",
        targetModel: null,
      }),
    ).rejects.toMatchObject({ code: "agent.invalidProvider" });
  });

  it("throws when already on same provider/model (sad path)", async () => {
    await seed();
    await expect(
      swapAgentProvider({
        storage,
        agentId: "agent-1",
        targetProvider: "opencode",
        targetModel: "gpt-5.1",
      }),
    ).rejects.toMatchObject({ code: "agent.sameProvider" });
  });
});

describe("buildPortingTranscript", () => {
  it("renders user and assistant messages with a blank line between turns", () => {
    expect(
      buildPortingTranscript([
        { type: "user_message", text: "First" },
        { type: "assistant_message", text: "Second" },
      ]),
    ).toBe("User: First\n\nAssistant: Second");
  });

  it("skips empty messages and reduces tool calls to a single line", () => {
    const transcript = buildPortingTranscript([
      { type: "user_message", text: "   " },
      { type: "tool_call", callId: "call-1", name: "search", status: "completed" },
      { type: "assistant_message", text: "" },
    ]);

    expect(transcript).toBe("Assistant used tool search (completed)");
  });
});

describe("buildPortedTimelineRows", () => {
  it("keeps the previous conversation and appends a completed porting marker", () => {
    const rows = buildPortedTimelineRows({
      previousRows: [
        {
          seq: 4,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: { type: "user_message", text: "hi" },
        },
        {
          seq: 5,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: { type: "assistant_message", text: "hello" },
        },
      ],
      fromProvider: "cline",
      toProvider: "opencode",
      portedAt: "2026-01-01T00:00:02.000Z",
    });

    expect(rows).toEqual([
      {
        seq: 1,
        timestamp: "2026-01-01T00:00:00.000Z",
        item: { type: "user_message", text: "hi" },
      },
      {
        seq: 2,
        timestamp: "2026-01-01T00:00:01.000Z",
        item: { type: "assistant_message", text: "hello" },
      },
      {
        seq: 3,
        timestamp: "2026-01-01T00:00:02.000Z",
        item: {
          type: "porting",
          status: "completed",
          fromProvider: "cline",
          toProvider: "opencode",
        },
      },
    ]);
  });

  it("records the marker even when the source conversation is empty", () => {
    const rows = buildPortedTimelineRows({
      previousRows: [],
      toProvider: "opencode",
      portedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(rows).toEqual([
      {
        seq: 1,
        timestamp: "2026-01-01T00:00:00.000Z",
        item: { type: "porting", status: "completed", toProvider: "opencode" },
      },
    ]);
  });
});

describe("swapAgentProvider archive deferral", () => {
  it("keeps the source unarchived when the caller archives it after switching", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "paseo-swap-defer-"));
    const storage = new AgentStorage(dir, createTestLogger());
    try {
      await storage.upsert({
        id: "agent-1",
        provider: "cline",
        cwd: "/tmp/project",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        labels: {},
        lastStatus: "closed",
        lastModeId: "act",
        config: { model: "act-model", modeId: "act" },
      } as unknown as Parameters<typeof storage.upsert>[0]);

      const result = await swapAgentProvider({
        storage,
        agentId: "agent-1",
        targetProvider: "opencode",
        targetModel: "opencode-model",
        archivePrevious: false,
      });

      const original = await storage.get("agent-1");
      expect(original?.archivedAt).toBeFalsy();
      expect(original?.migratedTo?.agentId).toBe(result.newAgentId);
      const ported = await storage.get(result.newAgentId);
      expect(ported?.config?.modeId).toBeUndefined();
      expect(ported?.lastModeId).toBeNull();
      expect(ported?.runtimeInfo?.modeId).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
