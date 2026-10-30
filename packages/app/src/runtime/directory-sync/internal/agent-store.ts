import equal from "fast-deep-equal";
import type { FetchAgentsEntry } from "@getpaseo/client/internal/daemon-client";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { acceptAgentDirectoryUpdate } from "@/utils/agent-directory-update-policy";
import { buildAgentDirectoryState, type AgentDirectoryDelta } from "@/utils/agent-directory-sync";
import { derivePendingPermissionKey, normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { resolveProjectPlacement } from "@/utils/project-placement";
import { settleInterruptedStreamItems } from "@/types/stream";
import { clearArchiveAgentPending } from "@/hooks/use-archive-agent";
import { queryClient } from "@/data/query-client";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { getInitDeferred, getInitKey, rejectInitDeferred } from "@/utils/agent-initialization";
import { reduceTurnLiveness, type TurnLivenessTransition } from "@/timeline/turn-liveness";

function withoutAgent(agentId: string) {
  return <T>(current: Map<string, T>): Map<string, T> => {
    if (!current.has(agentId)) return current;
    const next = new Map(current);
    next.delete(agentId);
    return next;
  };
}

function mergeSnapshotTurn(previous: Agent | undefined, incoming: Agent): Agent {
  if (!previous) return incoming;
  const activeTurn =
    incoming.turn.phase === "open"
      ? { turnId: incoming.turn.turnId, startedAt: incoming.turn.startedAt }
      : null;
  const turn = reduceTurnLiveness(previous.turn, { type: "snapshot", activeTurn });
  return turn === incoming.turn ? incoming : { ...incoming, turn };
}

export class AgentStoreProjection {
  constructor(private readonly serverId: string) {}

  snapshot(): Map<string, Agent> {
    return useSessionStore.getState().sessions[this.serverId]?.agents ?? new Map();
  }

  get(agentId: string): Agent | undefined {
    const session = useSessionStore.getState().sessions[this.serverId];
    return session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
  }

  commitCached(agents: Map<string, Agent>): Map<string, Agent> {
    const merged = new Map(agents);
    // The live store can hold newer stream-derived state than the directory
    // fetch, and the directory fetch can hold newer persisted state than the
    // cache. Resolve both with the same policy instead of letting the cached
    // entry win unconditionally.
    for (const [agentId, agent] of this.snapshot()) {
      const fetched = merged.get(agentId);
      merged.set(agentId, fetched ? acceptAgentDirectoryUpdate(agent, fetched) : agent);
    }
    for (const agent of merged.values()) this.publishActivity(agent);
    useSessionStore.getState().setAgents(this.serverId, merged);
    return merged;
  }

  publishActivity(agent: Agent): void {
    useSessionStore.getState().setAgentLastActivity(agent.id, agent.lastActivityAt);
  }

  accept(agent: Agent): Agent {
    let accepted = agent;
    let stoppedRunning = false;
    useSessionStore.getState().setAgents(this.serverId, (current) => {
      const previous = current.get(agent.id);
      accepted = acceptAgentDirectoryUpdate(previous, mergeSnapshotTurn(previous, agent));
      stoppedRunning = previous?.turn.phase === "open" && accepted.turn.phase === "idle";
      if (accepted === previous) return current;
      const next = new Map(current);
      next.set(agent.id, accepted);
      return next;
    });
    if (stoppedRunning) this.settleStream(accepted.id);
    return accepted;
  }

  applyDelta(delta: AgentDirectoryDelta): {
    agentId: string;
    stoppedRunning: boolean;
    agent?: Agent;
  } {
    if (delta.kind === "remove") {
      this.removeFromDirectory(delta.agentId);
      return { agentId: delta.agentId, stoppedRunning: false };
    }
    const normalized = normalizeAgentSnapshot(delta.agent, this.serverId);
    const session = useSessionStore.getState().sessions[this.serverId];
    const previous = session?.agents.get(normalized.id) ?? session?.agentDetails.get(normalized.id);
    const legacyWorkspaceId =
      previous?.workspaceId ??
      Array.from(session?.workspaces.values() ?? []).find(
        (workspace) =>
          session?.serverInfo?.features?.workspaceMultiplicity !== true &&
          workspace.workspaceDirectory === normalized.cwd,
      )?.id;
    const accepted = this.accept({
      ...normalized,
      workspaceId: normalized.workspaceId ?? legacyWorkspaceId,
      projectPlacement:
        resolveProjectPlacement({ projectPlacement: delta.project, cwd: normalized.cwd }) ??
        previous?.projectPlacement,
    });
    if (accepted.archivedAt) {
      clearArchiveAgentPending({ queryClient, serverId: this.serverId, agentId: accepted.id });
    }
    this.replacePendingPermissions(accepted);
    useSessionStore.getState().setAgentLastActivity(accepted.id, accepted.lastActivityAt);
    const stoppedRunning = previous?.turn.phase === "open" && accepted.turn.phase === "idle";
    return {
      agentId: accepted.id,
      stoppedRunning,
      agent: accepted,
    };
  }

  /**
   * Close live rows left behind by a turn that is no longer running. The server
   * settles them on a clean stop; an interrupted daemon leaves them open.
   */
  private settleStream(agentId: string): void {
    const store = useSessionStore.getState();
    const session = store.sessions[this.serverId];
    if (!session) return;
    const tail = session.agentStreamTail.get(agentId);
    const head = session.agentStreamHead.get(agentId);
    const nextTail = tail ? settleInterruptedStreamItems(tail) : undefined;
    const nextHead = head ? settleInterruptedStreamItems(head) : undefined;
    if ((!nextTail || nextTail === tail) && (!nextHead || nextHead === head)) return;
    store.setAgentStreamState(this.serverId, agentId, {
      ...(nextTail && nextTail !== tail ? { tail: nextTail } : {}),
      ...(nextHead && nextHead !== head ? { head: nextHead } : {}),
    });
  }

  replaceFetched(entries: FetchAgentsEntry[]): Map<string, Agent> {
    const { agents: fetched, pendingPermissions } = buildAgentDirectoryState({
      serverId: this.serverId,
      entries,
    });
    const store = useSessionStore.getState();
    const current = store.sessions[this.serverId]?.agents ?? new Map<string, Agent>();
    const agents = new Map<string, Agent>();
    for (const [agentId, fetchedAgent] of fetched) {
      const existing = current.get(agentId);
      const merged = mergeSnapshotTurn(existing, fetchedAgent);
      agents.set(agentId, existing && equal(existing, merged) ? existing : merged);
      if (existing?.turn.phase === "open" && merged.turn.phase === "idle") {
        this.settleStream(agentId);
      }
      if (fetchedAgent.archivedAt) {
        clearArchiveAgentPending({ queryClient, serverId: this.serverId, agentId });
      }
    }
    store.setAgents(this.serverId, agents);
    store.setAgentDetails(this.serverId, (previous) => {
      let next: Map<string, Agent> | null = null;
      for (const agentId of agents.keys()) {
        if (!previous.has(agentId)) continue;
        next ??= new Map(previous);
        next.delete(agentId);
      }
      return next ?? previous;
    });
    store.setAgentLastActivityBatch(
      new Map(Array.from(agents.values(), (agent) => [agent.id, agent.lastActivityAt])),
    );
    store.setPendingPermissions(this.serverId, new Map(pendingPermissions));
    store.setHasHydratedAgents(this.serverId, true);
    return agents;
  }

  replacePendingPermissions(agent: Agent): void {
    const pending = new Map(useSessionStore.getState().sessions[this.serverId]?.pendingPermissions);
    for (const [key, entry] of pending) if (entry.agentId === agent.id) pending.delete(key);
    for (const request of agent.pendingPermissions) {
      const key = derivePendingPermissionKey(agent.id, request);
      pending.set(key, { key, agentId: agent.id, request });
    }
    useSessionStore.getState().setPendingPermissions(this.serverId, pending);
  }

  removeFromDirectory(agentId: string): void {
    const store = useSessionStore.getState();
    const removeKey = withoutAgent(agentId);
    clearArchiveAgentPending({ queryClient, serverId: this.serverId, agentId });
    store.setAgents(this.serverId, removeKey);
    store.setAgentDetails(this.serverId, removeKey);
    store.setQueuedMessages(this.serverId, removeKey);
    store.setInitializingAgents(this.serverId, removeKey);
    store.setPendingPermissions(this.serverId, (current) => {
      const next = new Map(current);
      for (const [key, pending] of next) if (pending.agentId === agentId) next.delete(key);
      return next.size === current.size ? current : next;
    });
    useSessionStore.setState((state) => {
      if (!state.agentLastActivity.has(agentId)) return state;
      const agentLastActivity = new Map(state.agentLastActivity);
      agentLastActivity.delete(agentId);
      return { ...state, agentLastActivity };
    });
    useDraftStore.getState().clearDraftInput({
      draftKey: buildDraftStoreKey({ serverId: this.serverId, agentId }),
    });
    const initKey = getInitKey(this.serverId, agentId);
    if (getInitDeferred(initKey)) {
      rejectInitDeferred(initKey, new Error("Agent was removed during initialization"));
    }
  }

  remove(agentId: string): void {
    this.removeFromDirectory(agentId);
    // Only entity deletion destroys the transcript. A filtered active-list
    // response can arrive after a fresh history response for an archived agent.
    const store = useSessionStore.getState();
    const removeKey = withoutAgent(agentId);
    store.setAgentTimelineCursor(this.serverId, removeKey);
    store.setAgentAuthoritativeHistoryApplied(this.serverId, agentId, false);
    store.setAgentStreamTail(this.serverId, removeKey);
    store.clearAgentStreamHead(this.serverId, agentId);
  }

  archive(agentId: string, archivedAt: string): Agent | null {
    let archived: Agent | null = null;
    useSessionStore.getState().setAgents(this.serverId, (current) => {
      const agent = current.get(agentId);
      if (!agent) return current;
      archived = {
        ...agent,
        turn: { phase: "idle", cancellationRequestId: null },
        archivedAt: new Date(archivedAt),
      };
      const next = new Map(current);
      next.set(agentId, archived);
      return next;
    });
    return archived;
  }

  applyTurn(
    agentId: string,
    transition: TurnLivenessTransition | readonly TurnLivenessTransition[],
  ): Agent | null {
    const transitions = Array.isArray(transition) ? transition : [transition];
    let accepted: Agent | null = null;
    useSessionStore.getState().setAgents(this.serverId, (current) => {
      const agent = current.get(agentId);
      if (!agent) return current;
      const turn = transitions.reduce(reduceTurnLiveness, agent.turn);
      if (turn === agent.turn) return current;
      accepted = { ...agent, turn };
      const next = new Map(current);
      next.set(agentId, accepted);
      return next;
    });
    return accepted;
  }
}
