import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import type { TurnLiveness } from "@/timeline/turn-liveness";
import { summarizeHostAgents } from "./use-host-agent-summary";

const OPEN_TURN: TurnLiveness = {
  phase: "open",
  turnId: "turn-1",
  startedAt: new Date(0),
  cancellationRequestId: null,
};

function createAgent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    serverId: "host-a",
    id,
    provider: "codex",
    status: "idle",
    turn: { phase: "idle", cancellationRequestId: null },
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastUserMessageAt: null,
    lastActivityAt: new Date(0),
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsToolInvocations: false,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    cwd: "/repo",
    model: null,
    parentAgentId: null,
    workspaceId: "workspace-1",
    labels: {},
    ...overrides,
  };
}

function index(...agents: Agent[]): Map<string, Agent> {
  return new Map(agents.map((agent) => [agent.id, agent]));
}

describe("summarizeHostAgents", () => {
  it("returns an empty summary for a host with no agents", () => {
    expect(summarizeHostAgents(new Map())).toEqual({
      runningCount: 0,
      dominantBucket: null,
      attentionReason: null,
      hasFinished: false,
    });
  });

  it("counts running agents, including an open turn", () => {
    const summary = summarizeHostAgents(
      index(
        createAgent("a1", { status: "running", turn: OPEN_TURN }),
        createAgent("a2", { turn: OPEN_TURN }),
        createAgent("a3"),
      ),
    );
    expect(summary.runningCount).toBe(2);
    expect(summary.dominantBucket).toBe("running");
  });

  it("ranks needs_input above a running agent and surfaces the reason", () => {
    const summary = summarizeHostAgents(
      index(
        createAgent("a1", { status: "running" }),
        createAgent("a2", {
          requiresAttention: true,
          attentionReason: "permission",
          pendingPermissions: [{ id: "p1" } as Agent["pendingPermissions"][number]],
        }),
      ),
    );
    expect(summary.dominantBucket).toBe("needs_input");
    expect(summary.attentionReason).toBe("permission");
  });

  it("marks an unread finished agent as attention", () => {
    const summary = summarizeHostAgents(
      index(createAgent("a1", { requiresAttention: true, attentionReason: "finished" })),
    );
    expect(summary.dominantBucket).toBe("attention");
    expect(summary.hasFinished).toBe(true);
  });

  it("ignores archived agents and subagents", () => {
    const summary = summarizeHostAgents(
      index(
        createAgent("archived", { status: "running", archivedAt: new Date(0) }),
        createAgent("parent", { status: "idle" }),
        createAgent("child", { status: "running", parentAgentId: "parent" }),
      ),
    );
    expect(summary.runningCount).toBe(0);
    expect(summary.dominantBucket).toBe("done");
  });
});
