import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentManagerEvent } from "./agent/agent-manager.js";
import { writeJsonFileAtomic } from "./atomic-file.js";

export interface PlanBuildEntry {
  workspaceId: string;
  /** Absolute markdown path under `$PASEO_HOME/plans`. */
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
  /** Re-dispatch builds that were pending when the previous daemon stopped. */
  recoverPending(): Promise<void>;
}

const BUILD_END_EVENTS = new Set(["turn_completed", "turn_canceled", "turn_failed"]);

interface ActiveBuild {
  entry: PlanBuildEntry;
  dispatched: boolean;
}

export function createPlanBuildTracker(input: {
  paseoHome: string;
  emit: (update: PlanBuildUpdate) => void;
  subscribe: (listener: (event: AgentManagerEvent) => void) => () => void;
  dispatchBuild: (entry: PlanBuildEntry) => Promise<void>;
  onDispatchError: (error: unknown, entry: PlanBuildEntry) => void;
  onStoreError?: (error: unknown) => void;
}): PlanBuildTracker {
  const active = new Map<string, ActiveBuild>();
  const storePath = path.join(input.paseoHome, "plan-builds.json");
  let pendingWrite: Promise<void> = Promise.resolve();

  function persist(): void {
    const snapshot = [...active.values()].map((build) => build.entry);
    pendingWrite = pendingWrite
      .then(() => writeJsonFileAtomic(storePath, snapshot))
      .catch((error) => {
        input.onStoreError?.(error);
      });
  }

  function finish(entry: PlanBuildEntry): void {
    active.delete(entry.agentId);
    persist();
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
      persist();
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
      persist();
      input.emit({ ...entry, building: true });
    },
    async recoverPending() {
      let entries: PlanBuildEntry[] = [];
      try {
        const parsed: unknown = JSON.parse(await fs.readFile(storePath, "utf8"));
        if (Array.isArray(parsed)) entries = parsed as PlanBuildEntry[];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") input.onStoreError?.(error);
      }
      if (entries.length === 0) return;
      await pendingWrite;
      for (const entry of entries) {
        // The previous runtime is gone, so no turn event will clear this marker or send
        // the build prompt. Start a fresh build turn for each interrupted entry.
        active.set(entry.agentId, { entry, dispatched: true });
        input.emit({ ...entry, building: true });
        dispatch(entry);
      }
      persist();
    },
  };
}
