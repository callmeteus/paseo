import type { AgentManagerEvent } from "./agent/agent-manager.js";

export interface PlanBuildEntry {
  workspaceId: string;
  /** Workspace-relative markdown path. */
  path: string;
  title: string;
  agentId: string;
}

export interface PlanBuildUpdate extends PlanBuildEntry {
  /** Omitted by plan_create_update; build-state updates always set it. */
  building?: boolean;
}

export interface PlanBuildTracker {
  /**
   * Marks the plan as building and queues the build. The build prompt goes out
   * when the caller's current turn ends, so it runs in a fresh turn that carries
   * the Agent workflow prompt for every provider. The marker clears when that
   * build turn finishes.
   */
  start(entry: PlanBuildEntry): void;
}

const BUILD_END_EVENTS = new Set(["turn_completed", "turn_canceled", "turn_failed"]);

interface ActiveBuild {
  entry: PlanBuildEntry;
  dispatched: boolean;
}

export function createPlanBuildTracker(input: {
  emit: (update: PlanBuildUpdate) => void;
  subscribe: (listener: (event: AgentManagerEvent) => void) => () => void;
  dispatchBuild: (entry: PlanBuildEntry) => Promise<void>;
  onDispatchError: (error: unknown, entry: PlanBuildEntry) => void;
}): PlanBuildTracker {
  const active = new Map<string, ActiveBuild>();

  function finish(entry: PlanBuildEntry): void {
    active.delete(entry.agentId);
    input.emit({ ...entry, building: false });
  }

  function dispatch(entry: PlanBuildEntry): void {
    void input.dispatchBuild(entry).catch((error) => {
      input.onDispatchError(error, entry);
      finish(entry);
    });
  }

  input.subscribe((event) => {
    if (event.type !== "agent_stream") return;
    if (!BUILD_END_EVENTS.has(event.event.type)) return;
    const current = active.get(event.agentId);
    if (!current) return;
    // The turn that called plan_build has to end before the build prompt runs;
    // otherwise it would steer into a turn still under Plan instructions.
    if (!current.dispatched) {
      current.dispatched = true;
      dispatch(current.entry);
      return;
    }
    finish(current.entry);
  });

  return {
    start(entry) {
      const previous = active.get(entry.agentId);
      if (previous && previous.entry.path !== entry.path) {
        input.emit({ ...previous.entry, building: false });
      }
      active.set(entry.agentId, { entry, dispatched: false });
      input.emit({ ...entry, building: true });
    },
  };
}
