import { create } from "zustand";
import { formatSelectionQuote } from "@/assistant-selection-copy/quote";
import { useDraftStore } from "@/stores/draft-store";
import { useSessionStore } from "@/stores/session-store";
import type { SideChatItem } from "@getpaseo/protocol/messages";
import { sideChatDraftKey } from "./draft-key";

interface SideChatState {
  openAgentIds: Record<string, boolean>;
  focusRequest: Record<string, number>;
  transcript: Record<string, SideChatItem[]>;
  liveText: Record<string, string>;
  pending: Record<string, boolean>;
  error: Record<string, string | null>;
  open: (agentId: string) => void;
  close: (agentId: string) => void;
  requestFocus: (agentId: string) => void;
  refresh: (serverId: string, agentId: string) => Promise<void>;
  send: (serverId: string, agentId: string, text: string) => Promise<void>;
  submitDraft: (serverId: string, agentId: string) => Promise<void>;
  clear: (serverId: string, agentId: string) => Promise<void>;
}

const generation = new Map<string, number>();

function clientFor(serverId: string) {
  const client = useSessionStore.getState().sessions[serverId]?.client ?? null;
  if (!client) throw new Error("Host is not connected");
  return client;
}

export const useSideChatStore = create<SideChatState>((set, get) => ({
  openAgentIds: {},
  focusRequest: {},
  transcript: {},
  liveText: {},
  pending: {},
  error: {},
  open: (agentId) => set((state) => ({ openAgentIds: { ...state.openAgentIds, [agentId]: true } })),
  close: (agentId) =>
    set((state) => ({ openAgentIds: { ...state.openAgentIds, [agentId]: false } })),
  requestFocus: (agentId) =>
    set((state) => ({
      openAgentIds: { ...state.openAgentIds, [agentId]: true },
      focusRequest: { ...state.focusRequest, [agentId]: (state.focusRequest[agentId] ?? 0) + 1 },
    })),
  refresh: async (serverId, agentId) => {
    const items = await clientFor(serverId).getSideChat(agentId);
    set((state) => ({ transcript: { ...state.transcript, [agentId]: items } }));
  },
  send: async (serverId, agentId, text) => {
    const question = text.trim();
    if (!question) return;
    const token = (generation.get(agentId) ?? 0) + 1;
    generation.set(agentId, token);
    set((state) => ({
      openAgentIds: { ...state.openAgentIds, [agentId]: true },
      pending: { ...state.pending, [agentId]: true },
      liveText: { ...state.liveText, [agentId]: "" },
      error: { ...state.error, [agentId]: null },
    }));
    try {
      await clientFor(serverId).askSideQuestion({
        agentId,
        text: question,
        onDelta: (delta) => {
          if (generation.get(agentId) !== token) return;
          set((state) => ({
            liveText: { ...state.liveText, [agentId]: `${state.liveText[agentId] ?? ""}${delta}` },
          }));
        },
      });
      if (generation.get(agentId) !== token) return;
      set((state) => ({ liveText: { ...state.liveText, [agentId]: "" } }));
      await get().refresh(serverId, agentId);
    } catch (error) {
      if (generation.get(agentId) !== token) return;
      const message = error instanceof Error ? error.message : String(error);
      if (message === "canceled") return;
      set((state) => ({ error: { ...state.error, [agentId]: message } }));
    } finally {
      if (generation.get(agentId) === token) {
        set((state) => ({ pending: { ...state.pending, [agentId]: false } }));
      }
    }
  },
  submitDraft: async (serverId, agentId) => {
    const draftKey = sideChatDraftKey(serverId, agentId);
    const draft = useDraftStore.getState().getDraftInput(draftKey);
    const quotes = (draft?.attachments ?? [])
      .filter((attachment) => attachment.kind === "quote")
      .map((attachment) => formatSelectionQuote(attachment.text));
    const text = [draft?.text.trim() ?? "", ...quotes]
      .filter((part) => part.length > 0)
      .join("\n\n");
    useDraftStore.getState().clearDraftInput({ draftKey, lifecycle: "sent" });
    await get().send(serverId, agentId, text);
  },
  clear: async (serverId, agentId) => {
    await clientFor(serverId).clearSideChat(agentId);
    set((state) => ({
      transcript: { ...state.transcript, [agentId]: [] },
      liveText: { ...state.liveText, [agentId]: "" },
      error: { ...state.error, [agentId]: null },
    }));
  },
}));
