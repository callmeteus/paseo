import { getParentAddressFromLabels } from "@getpaseo/protocol/agent-labels";
import { useSessionStore } from "@/stores/session-store";
import type { QueuedComposerMessage } from "./actions";
import { persistAgentMessageQueue } from "./queue-persistence";

export interface QueueAgentAddress {
  serverId: string;
  agentId: string;
}

/**
 * Resolve the agents that mirror a queue on connected hosts.
 *
 * Agent ids are generated independently by each daemon, so a queue written on
 * one host has no meaning on another. Delegated children carry their parent's
 * address in `paseo.parent-*` labels; that pair is the only identity mapping
 * shared across daemons. Replication follows parent to child, which also keeps
 * the fan-out acyclic.
 */
export function findQueueReplicaTargets(source: QueueAgentAddress): QueueAgentAddress[] {
  const sessions = useSessionStore.getState().sessions;
  const targets: QueueAgentAddress[] = [];
  for (const [serverId, session] of Object.entries(sessions)) {
    for (const [agentId, agent] of session.agents) {
      if (agent.archivedAt) continue;
      const parent = getParentAddressFromLabels(agent.labels, serverId);
      if (!parent) continue;
      if (parent.serverId !== source.serverId || parent.agentId !== source.agentId) continue;
      if (serverId === source.serverId && agentId === source.agentId) continue;
      targets.push({ serverId, agentId });
    }
  }
  return targets;
}

/** Persist the queue on its own daemon and on every delegated child host. */
export function persistQueueWithReplicas(input: {
  source: QueueAgentAddress;
  client: Parameters<typeof persistAgentMessageQueue>[0];
  items: readonly QueuedComposerMessage[];
}): Promise<void> {
  const local = persistAgentMessageQueue(input.client, input.source.agentId, input.items);
  const targets = findQueueReplicaTargets(input.source);
  const replicas = Promise.all(
    targets.map(async (target) => {
      const session = useSessionStore.getState().sessions[target.serverId];
      if (!session?.client || session.serverInfo?.features?.agentMessageQueue !== true) return;
      await persistAgentMessageQueue(session.client, target.agentId, input.items);
    }),
  );
  return Promise.all([local, replicas]).then(() => undefined);
}
