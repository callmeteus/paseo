import { create } from "zustand";

interface ModelPickerRequestState {
  agentId: string | null;
  nonce: number;
  request: (agentId: string) => void;
}

/** Ask the composer for `agentId` to open its model picker (stream error cards, etc.). */
export const useModelPickerRequestStore = create<ModelPickerRequestState>((set) => ({
  agentId: null,
  nonce: 0,
  request: (agentId: string) => {
    set((state) => ({
      agentId,
      nonce: state.agentId === agentId ? state.nonce + 1 : 1,
    }));
  },
}));
