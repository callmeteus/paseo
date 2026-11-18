import { create } from "zustand";

interface ModelPickerRequestState {
  agentId: string | null;
  nonce: number;
  /** The nonce whose pick must also retry the rejected prompt. */
  retryNonce: number;
  request: (agentId: string, options?: { retryAfterPick?: boolean }) => void;
  clearIntent: () => void;
}

/** Ask the composer for `agentId` to open its model picker (stream error cards, etc.). */
export const useModelPickerRequestStore = create<ModelPickerRequestState>((set) => ({
  agentId: null,
  nonce: 0,
  retryNonce: 0,
  request: (agentId: string, options?: { retryAfterPick?: boolean }) => {
    set((state) => {
      const nonce = state.agentId === agentId ? state.nonce + 1 : 1;
      return {
        agentId,
        nonce,
        retryNonce: options?.retryAfterPick === true ? nonce : 0,
      };
    });
  },
  clearIntent: () => set({ retryNonce: 0 }),
}));

/** The open request for one agent, plus whether its pick must retry a rejected prompt. */
export function useModelPickerRequest(agentId: string): { openNonce: number; retry: boolean } {
  const openNonce = useModelPickerRequestStore((state) =>
    state.agentId === agentId ? state.nonce : 0,
  );
  const retryNonce = useModelPickerRequestStore((state) =>
    state.agentId === agentId ? state.retryNonce : 0,
  );
  return { openNonce, retry: openNonce > 0 && retryNonce === openNonce };
}
