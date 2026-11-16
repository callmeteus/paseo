import type { ComposerAttachment } from "@/attachments/types";
import type { QueueWriter, QueuedComposerMessage } from "@/composer/actions";
import { EMPTY_QUEUE, useDraftMessageQueueStore } from "@/composer/draft/message-queue-store";
import { persistAgentMessageQueue } from "@/composer/queue-persistence";
import { useSessionStore } from "@/stores/session-store";

export function buildDraftQueueKey(input: { serverId: string; draftId: string }): string {
  return `${input.serverId}:${input.draftId.trim()}`;
}

export function useDraftQueue(key: string): QueuedComposerMessage[] {
  const byKey = useDraftMessageQueueStore((state) => state.byKey);
  return byKey.get(key) ?? EMPTY_QUEUE;
}

/**
 * Queue operations are keyed by agent; before creation the composer still passes
 * its own agent id, so the writer translates it onto the draft key.
 */
export function createDraftQueueWriter(input: { key: string; agentId: string }): QueueWriter {
  const store = () => useDraftMessageQueueStore.getState();
  return {
    read: () => store().byKey.get(input.key) ?? EMPTY_QUEUE,
    write: (updater) => {
      const keyed = new Map([[input.agentId, store().byKey.get(input.key) ?? EMPTY_QUEUE]]);
      store().setDraftQueue(input.key, updater(keyed).get(input.agentId) ?? EMPTY_QUEUE);
    },
  };
}

/** Creation failed: the messages have nowhere to go, so put them back in the draft. */
export function restoreDraftQueueToComposer(input: {
  key: string;
  currentText: string;
  currentAttachments: ComposerAttachment[];
}): { text: string; attachments: ComposerAttachment[] } | null {
  const items = useDraftMessageQueueStore.getState().takeDraftQueue(input.key);
  if (items.length === 0) return null;
  return {
    text: [input.currentText, ...items.map((item) => item.text)]
      .filter((text) => text.trim().length > 0)
      .join("\n\n"),
    attachments: [...input.currentAttachments, ...items.flatMap((item) => item.attachments)],
  };
}

/** Hands everything the user sent during creation to the agent, in order. */
export function moveDraftQueueToAgent(input: {
  key: string;
  serverId: string;
  agentId: string;
}): QueuedComposerMessage[] {
  const items = useDraftMessageQueueStore.getState().takeDraftQueue(input.key);
  if (items.length === 0) return EMPTY_QUEUE;

  const session = useSessionStore.getState().sessions[input.serverId];
  const merged = [...(session?.queuedMessages.get(input.agentId) ?? []), ...items];
  useSessionStore.getState().setQueuedMessages(input.serverId, (previous) => {
    const next = new Map(previous);
    next.set(input.agentId, merged);
    return next;
  });

  const client = session?.client ?? null;
  if (client && session?.serverInfo?.features?.agentMessageQueue === true) {
    void persistAgentMessageQueue(client, input.agentId, merged).catch((error) => {
      console.error("[DraftMessageQueue] Failed to persist the created agent's queue", error);
    });
  }

  return items;
}
