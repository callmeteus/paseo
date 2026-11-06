import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { z } from "zod";

/** One chat the user asked to continue. The choice is never a global setting. */
export interface ArmedLimitResume {
  serverId: string;
  resetAt: number;
}

const persistedSchema = z.object({
  byAgentId: z.record(
    z.string(),
    z.object({
      serverId: z.string(),
      resetAt: z.number(),
    }),
  ),
});

interface LimitResumeStore {
  byAgentId: Record<string, ArmedLimitResume>;
  arm: (agentId: string, entry: ArmedLimitResume) => void;
  disarm: (agentId: string) => void;
}

export const useLimitResumeStore = create<LimitResumeStore>()(
  persist(
    (set) => ({
      byAgentId: {},
      arm: (agentId, entry) =>
        set((state) => ({
          byAgentId: { ...state.byAgentId, [agentId]: entry },
        })),
      disarm: (agentId) =>
        set((state) => {
          if (!(agentId in state.byAgentId)) return state;
          const { [agentId]: _removed, ...byAgentId } = state.byAgentId;
          return { byAgentId };
        }),
    }),
    {
      name: "limit-resume",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ byAgentId: state.byAgentId }),
      merge: (persisted, current) => {
        const parsed = persistedSchema.safeParse(persisted);
        if (!parsed.success) return current;
        return { ...current, byAgentId: parsed.data.byAgentId };
      },
    },
  ),
);
