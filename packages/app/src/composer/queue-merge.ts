import type { QueuedComposerMessage } from "./actions";

/**
 * Merge a daemon queue into the client's live queue by message id.
 *
 * The daemon owns the order of the items it knows; local items that have not
 * reached the daemon yet are kept at the end. Merging by id makes hydration and
 * repeated queue-change events idempotent, so a restored queue no longer wipes
 * what the user typed while the connection was down.
 */
export function mergeQueuedMessages(
  local: readonly QueuedComposerMessage[] | undefined,
  remote: readonly QueuedComposerMessage[],
): QueuedComposerMessage[] {
  if (remote.length === 0) return [...(local ?? [])];
  const remoteIds = new Set(remote.map((item) => item.id));
  const localOnly = (local ?? []).filter((item) => !remoteIds.has(item.id));
  return [...remote, ...localOnly];
}
