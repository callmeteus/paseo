import { describe, expect, it } from "vitest";
import { AgentSnapshotSchema } from "./agent-snapshot.js";

describe("AgentSnapshotSchema", () => {
  it("parses a valid snapshot", () => {
    const snapshot = {
      version: "paseo.agent-snapshot/v1",
      agentId: "a1",
      provider: "opencode",
      cwd: "/tmp",
      createdAt: "2026-01-01T00:00:00.000Z",
      turns: [
        {
          role: "user",
          blocks: [{ type: "text", text: "hello" }],
        },
      ],
    };
    const parsed = AgentSnapshotSchema.parse(snapshot);
    expect(parsed.agentId).toBe("a1");
    expect(parsed.turns).toHaveLength(1);
  });

  it("rejects missing required fields", () => {
    expect(() => AgentSnapshotSchema.parse({ version: "paseo.agent-snapshot/v1" })).toThrow();
  });

  it("accepts extra fields (passthrough-friendly parse)", () => {
    const snapshot = {
      version: "paseo.agent-snapshot/v1",
      agentId: "a1",
      provider: "opencode",
      cwd: "/tmp",
      createdAt: "2026-01-01T00:00:00.000Z",
      turns: [],
      futureField: 42,
    };
    // zod default strips unknown; ensure parse succeeds
    expect(() => AgentSnapshotSchema.parse(snapshot)).not.toThrow();
  });
});
