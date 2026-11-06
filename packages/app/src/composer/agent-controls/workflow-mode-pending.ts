const pendingWorkflowMode = new Map<string, Promise<void>>();

/**
 * Remembers the workflow-mode RPC for one chat.
 * Sending waits on it so the message cannot leave under the previous mode.
 */
export function trackWorkflowModeChange(agentId: string, task: Promise<unknown>): void {
  const settled = task.then(
    () => undefined,
    () => undefined,
  );
  pendingWorkflowMode.set(agentId, settled);
  void settled.finally(() => {
    if (pendingWorkflowMode.get(agentId) === settled) pendingWorkflowMode.delete(agentId);
  });
}

export function workflowModeSettled(agentId: string): Promise<void> {
  return pendingWorkflowMode.get(agentId) ?? Promise.resolve();
}
