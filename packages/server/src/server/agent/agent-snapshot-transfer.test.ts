import { describe, expect, it } from "vitest";
import type { AgentSnapshot } from "@getpaseo/protocol/agent-snapshot";
import { buildImportedSystemPrompt, buildImportedTimelineRows } from "./agent-snapshot-transfer";
import { PORTED_CONTEXT_MARKER } from "./system-prompt";

function snapshot(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    version: "paseo.agent-snapshot/v1",
    agentId: "source-agent",
    title: "Ported chat",
    provider: "cline",
    model: "cline-pro",
    cwd: "/tmp/project",
    createdAt: "2026-01-01T00:00:00.000Z",
    turns: [],
    ...overrides,
  };
}

describe("buildImportedTimelineRows", () => {
  it("projects imported turns and records the porting marker last", () => {
    const rows = buildImportedTimelineRows(
      snapshot({
        turns: [
          {
            role: "user",
            blocks: [{ type: "text", text: "hi" }],
            timestamp: "2026-01-01T00:00:01.000Z",
          },
          {
            role: "assistant",
            blocks: [{ type: "text", text: "hello" }],
            timestamp: "2026-01-01T00:00:02.000Z",
          },
        ],
      }),
      "opencode",
    );

    expect(rows.map((row) => row.item)).toEqual([
      { type: "user_message", text: "hi" },
      { type: "assistant_message", text: "hello" },
      {
        type: "porting",
        status: "completed",
        fromProvider: "cline",
        toProvider: "opencode",
      },
    ]);
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3]);
  });

  it("records the marker even when the snapshot has no turns", () => {
    const rows = buildImportedTimelineRows(snapshot(), "kilo");

    expect(rows).toEqual([
      expect.objectContaining({
        seq: 1,
        item: {
          type: "porting",
          status: "completed",
          fromProvider: "cline",
          toProvider: "kilo",
        },
      }),
    ]);
  });
});

describe("buildImportedSystemPrompt", () => {
  it("wraps snapshot turns in the ported-from marker block", () => {
    const keyword = "pindamonhangaba";
    const prompt = buildImportedSystemPrompt(
      snapshot({
        turns: [
          {
            role: "user",
            blocks: [{ type: "text", text: `Remember ${keyword}` }],
            timestamp: "2026-01-01T00:00:01.000Z",
          },
        ],
      }),
    );
    expect(prompt).toBeDefined();
    expect(prompt).toContain(PORTED_CONTEXT_MARKER);
    expect(prompt).toContain("cline");
    expect(prompt).toContain(keyword);
    expect(prompt).toContain("User: Remember");
  });
});
