import type { QueuedComposerMessage } from "@/composer/actions";
import { create } from "zustand";

/**
 * Messages sent before the agent exists, keyed by draft. This module must stay
 * dependency-free: the draft store imports it to retain queued images during
 * garbage collection, and anything heavier here closes an import cycle.
 */
interface DraftMessageQueueState {
  byKey: Map<string, QueuedComposerMessage[]>;
}

interface DraftMessageQueueActions {
  setDraftQueue: (key: string, items: QueuedComposerMessage[]) => void;
  takeDraftQueue: (key: string) => QueuedComposerMessage[];
}

export const useDraftMessageQueueStore = create<
  DraftMessageQueueState & DraftMessageQueueActions
>()((set, get) => ({
  byKey: new Map(),
  setDraftQueue: (key, items) =>
    set((state) => {
      const next = new Map(state.byKey);
      if (items.length === 0) {
        if (!next.has(key)) return state;
        next.delete(key);
      } else {
        next.set(key, items);
      }
      return { byKey: next };
    }),
  takeDraftQueue: (key) => {
    const items = get().byKey.get(key);
    if (!items?.length) return EMPTY_QUEUE;
    set((state) => {
      const next = new Map(state.byKey);
      next.delete(key);
      return { byKey: next };
    });
    return items;
  },
}));

export const EMPTY_QUEUE: QueuedComposerMessage[] = [];
