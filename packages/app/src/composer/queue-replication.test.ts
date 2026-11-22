import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { afterEach, describe, expect, it } from "vitest";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { findQueueReplicaTargets } from "./queue-replication";

const SOURCE_SERVER = "server-a";
const TARGET_SERVER = "server-b";
const TIMESTAMP = new Date("2026-03-08T10:00:00.000Z");

const AGENT_DEFAULTS: Agent = {
  serverId: SOURCE_SERVER,
  id: "agent",
  provider: "codex",
  status: "idle",
  turn: { phase: "idle", cancellationRequestId: null },
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
  lastUserMessageAt: null,
  lastActivityAt: TIMESTAMP,
  capabilities: {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: true,
    supportsMcpServers: true,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
  },
  currentModeId: null,
  availableModes: [],
  pendingPermissions: [],
  persistence: null,
  lastError: null,
  title: "Agent",
  cwd: "/tmp/project",
  model: null,
  requiresAttention: false,
  attentionReason: null,
  attentionTimestamp: null,
  archivedAt: null,
  parentAgentId: null,
  labels: {},
  projectPlacement: null,
};

function agent(input: Partial<Agent> & Pick<Agent, "id" | "serverId">): Agent {
  return { ...AGENT_DEFAULTS, ...input };
}

function setAgents(serverId: string, agents: Agent[]): void {
  useSessionStore.getState().initializeSession(serverId, null as unknown as DaemonClient);
  useSessionStore.getState().setAgents(serverId, new Map(agents.map((entry) => [entry.id, entry])));
}

afterEach(() => {
  useSessionStore.getState().clearSession(SOURCE_SERVER);
  useSessionStore.getState().clearSession(TARGET_SERVER);
});

describe("findQueueReplicaTargets", () => {
  it("finds a delegated child on a connected host", () => {
    setAgents(SOURCE_SERVER, [agent({ id: "parent", serverId: SOURCE_SERVER })]);
    setAgents(TARGET_SERVER, [
      agent({
        id: "child",
        serverId: TARGET_SERVER,
        labels: {
          "paseo.parent-agent-id": "parent",
          "paseo.parent-server-id": SOURCE_SERVER,
        },
      }),
    ]);

    expect(findQueueReplicaTargets({ serverId: SOURCE_SERVER, agentId: "parent" })).toEqual([
      { serverId: TARGET_SERVER, agentId: "child" },
    ]);
  });

  it("ignores archived children and children of another parent", () => {
    setAgents(SOURCE_SERVER, [agent({ id: "parent", serverId: SOURCE_SERVER })]);
    setAgents(TARGET_SERVER, [
      agent({
        id: "archived",
        serverId: TARGET_SERVER,
        archivedAt: TIMESTAMP,
        labels: {
          "paseo.parent-agent-id": "parent",
          "paseo.parent-server-id": SOURCE_SERVER,
        },
      }),
      agent({
        id: "other-child",
        serverId: TARGET_SERVER,
        labels: {
          "paseo.parent-agent-id": "other-parent",
          "paseo.parent-server-id": SOURCE_SERVER,
        },
      }),
    ]);

    expect(findQueueReplicaTargets({ serverId: SOURCE_SERVER, agentId: "parent" })).toEqual([]);
  });

  it("treats a parent label without a server as same-host", () => {
    setAgents(SOURCE_SERVER, [
      agent({ id: "parent", serverId: SOURCE_SERVER }),
      agent({
        id: "child",
        serverId: SOURCE_SERVER,
        labels: { "paseo.parent-agent-id": "parent" },
      }),
    ]);

    expect(findQueueReplicaTargets({ serverId: SOURCE_SERVER, agentId: "parent" })).toEqual([
      { serverId: SOURCE_SERVER, agentId: "child" },
    ]);
  });
});
