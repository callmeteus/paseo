import { describe, expect, it } from "vitest";
import type { AgentSnapshot } from "@getpaseo/protocol/agent-snapshot";
import { buildImportedTimelineRows } from "./agent-snapshot-transfer";

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
