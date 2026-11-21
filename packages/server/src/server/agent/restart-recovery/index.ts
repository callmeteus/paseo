import type { AgentStorage, StoredAgentRecord } from "../agent-storage.js";

interface Dependencies {
  storage: AgentStorage;
  settings(): { enabled: boolean; prompt: string };
  /** Exclude archived, private, owned, or otherwise ineligible records. */
  eligible(record: StoredAgentRecord): Promise<boolean>;
  dispatch(agentId: string, prompt: string): Promise<unknown>;
  report(agentId: string, error: unknown): void;
}

/**
 * Continues work that was interrupted by a daemon restart.
 *
 * Intent is saved before the shutdown closes runtimes, then consumed once. Startup only
 * chooses candidates; reopening and prompting run in the background after connections
 * open, so a slow provider holds back only its own agent.
 */
export function createRestartRecovery(deps: Dependencies) {
  const resuming = new Map<string, { promise: Promise<void>; resolve(): void }>();

  const eligible = async (record: StoredAgentRecord) =>
    !record.archivedAt &&
    record.internal !== true &&
    !record.owner &&
    (await deps.eligible(record));

  async function resume(agentId: string) {
    const record = await deps.storage.get(agentId);
    if (!record?.resumeOnStartup) return;
    await deps.storage.upsert({ ...record, resumeOnStartup: false });
    const settings = deps.settings();
    if (!settings.enabled || !(await eligible(record))) return;
    await deps.dispatch(agentId, settings.prompt);
  }

  return {
    /** Choose candidates before anything else reads or repairs persisted running status. */
    async prepareStartup(): Promise<void> {
      for (const record of await deps.storage.list()) {
        const busy = record.lastStatus === "running" || record.lastStatus === "initializing";
        const pending =
          deps.settings().enabled &&
          (record.resumeOnStartup === true || record.lastStatus === "running") &&
          (await eligible(record));
        if (!busy && pending === (record.resumeOnStartup === true)) continue;
        await deps.storage.upsert({
          ...record,
          resumeOnStartup: pending,
          lastStatus: busy ? "closed" : record.lastStatus,
        });
        if (pending) {
          let resolve!: () => void;
          const promise = new Promise<void>((settle) => {
            resolve = settle;
          });
          resuming.set(record.id, { promise, resolve });
        }
      }
    },

    /** Record intent before runtimes close on a graceful shutdown. */
    async captureRunningAgents(): Promise<void> {
      await deps.storage.flush();
      for (const record of await deps.storage.list()) {
        if (record.lastStatus !== "running" || !(await eligible(record))) continue;
        await deps.storage.upsert({ ...record, resumeOnStartup: deps.settings().enabled });
      }
      await deps.storage.flush();
    },

    /** Resume every candidate in the background. */
    resumePending(): void {
      for (const [agentId, settled] of resuming) {
        void resume(agentId)
          .catch((error) => deps.report(agentId, error))
          .finally(() => {
            resuming.delete(agentId);
            settled.resolve();
          });
      }
    },

    /** Wait until this agent's resume was sent or abandoned. Others return at once. */
    async waitForResume(agentId: string, signal: AbortSignal): Promise<void> {
      const settled = resuming.get(agentId);
      if (!settled) return;
      let abort!: () => void;
      const aborted = new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason);
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
      try {
        await Promise.race([settled.promise, aborted]);
      } finally {
        signal.removeEventListener("abort", abort);
      }
    },
  };
}
