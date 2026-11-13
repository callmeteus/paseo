import { create } from "zustand";
import type { ComposerAttachment } from "@/attachments/types";

/**
 * The last message sent to each agent, kept only long enough to undo a send the
 * provider rejected before producing anything. The daemon drops that prompt from
 * the timeline and asks for it back; the text and attachments come from here.
 */
export interface PendingComposerSend {
  clientMessageId: string;
  text: string;
  attachments: ComposerAttachment[];
}

interface PendingComposerSendStore {
  byAgent: Record<string, PendingComposerSend>;
  remember: (input: { serverId: string; agentId: string; send: PendingComposerSend }) => void;
  take: (input: {
    serverId: string;
    agentId: string;
    clientMessageId: string;
  }) => PendingComposerSend | null;
  clear: (input: { serverId: string; agentId: string }) => void;
}

function sendKey(input: { serverId: string; agentId: string }): string {
  return `${input.serverId}:${input.agentId}`;
}

export const usePendingComposerSendStore = create<PendingComposerSendStore>()((set, get) => ({
  byAgent: {},
  remember: ({ serverId, agentId, send }) =>
    set((state) => ({
      byAgent: { ...state.byAgent, [sendKey({ serverId, agentId })]: send },
    })),
  take: ({ serverId, agentId, clientMessageId }) => {
    const key = sendKey({ serverId, agentId });
    const send = get().byAgent[key];
    if (!send || send.clientMessageId !== clientMessageId) return null;
    const byAgent = { ...get().byAgent };
    delete byAgent[key];
    set({ byAgent });
    return send;
  },
  clear: ({ serverId, agentId }) =>
    set((state) => {
      const key = sendKey({ serverId, agentId });
      if (!(key in state.byAgent)) return state;
      const byAgent = { ...state.byAgent };
      delete byAgent[key];
      return { byAgent };
    }),
}));
