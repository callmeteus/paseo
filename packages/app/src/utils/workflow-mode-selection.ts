/**
 * The workflow-mode pill is chosen on the client and confirmed by
 * `agent.workflow_mode.set`. Directory snapshots, timeline hydration and turn
 * echoes also carry `workflowModeId`, but their `updatedAt` moves for turn
 * activity, so a payload captured before the choice can arrive last and put
 * the previous mode back.
 *
 * `revision` is client-only. A choice bumps it. A snapshot applies only when
 * it carries a strictly newer revision, or when the user has not chosen yet
 * (revision 0). The RPC confirm for that same revision may still apply the
 * id the server accepted.
 */

export interface WorkflowModeSelection {
  modeId: string | null;
  revision: number;
}

export type WorkflowModeEvent =
  | { type: "choose"; modeId: string }
  | { type: "send" }
  | { type: "snapshot"; modeId: string | null; revision?: number }
  | { type: "confirm"; modeId: string | null; revision: number }
  | { type: "reject"; revision: number; modeId: string | null };

export function reduceWorkflowModeSelection(
  state: WorkflowModeSelection,
  event: WorkflowModeEvent,
): WorkflowModeSelection {
  switch (event.type) {
    case "choose":
      if (state.modeId === event.modeId && state.revision > 0) return state;
      return { modeId: event.modeId, revision: state.revision + 1 };
    case "send":
      // The message leaves with the mode `choose` already latched. Sending
      // must not freeze hydration for a chat the user never touched.
      return state;
    case "snapshot": {
      const incomingRevision = event.revision ?? 0;
      if (incomingRevision > state.revision) {
        return { modeId: event.modeId, revision: incomingRevision };
      }
      if (state.revision > 0) return state;
      return { modeId: event.modeId, revision: 0 };
    }
    case "confirm":
      if (event.revision < state.revision) return state;
      return { modeId: event.modeId, revision: Math.max(state.revision, event.revision) };
    case "reject":
      if (event.revision !== state.revision) return state;
      return { modeId: event.modeId, revision: Math.max(0, event.revision - 1) };
  }
}

interface WorkflowModeCarrier {
  workflowModeId?: string | null;
  workflowModeRevision?: number;
}

/**
 * Keeps a latched choice when a directory row is accepted because its
 * `updatedAt` is newer. The rest of the row still wins.
 */
export function preserveChosenWorkflowMode<T extends WorkflowModeCarrier>(
  current: T | undefined,
  incoming: T,
): T {
  if (!current) return incoming;
  const next = reduceWorkflowModeSelection(
    {
      modeId: current.workflowModeId ?? null,
      revision: current.workflowModeRevision ?? 0,
    },
    {
      type: "snapshot",
      modeId: incoming.workflowModeId ?? null,
      revision: incoming.workflowModeRevision ?? 0,
    },
  );
  const incomingMode = incoming.workflowModeId ?? null;
  const incomingRevision = incoming.workflowModeRevision ?? 0;
  if (next.modeId === incomingMode && next.revision === incomingRevision) return incoming;
  return { ...incoming, workflowModeId: next.modeId, workflowModeRevision: next.revision };
}
