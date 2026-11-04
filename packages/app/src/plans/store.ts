import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createJSONStorage, persist } from "zustand/middleware";

export interface PlanRecord {
  serverId: string;
  workspaceId: string;
  path: string;
  title: string;
  agentId: string;
}

interface PlanStore {
  plans: Record<string, PlanRecord>;
  setPlan: (plan: PlanRecord) => void;
}

export function planKey(input: { serverId: string; workspaceId: string; path: string }): string {
  const path = input.path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
  return `${input.serverId}:${input.workspaceId}:${path}`;
}

export const usePlanStore = create<PlanStore>()(
  persist(
    (set) => ({
      plans: {},
      setPlan: (plan) =>
        set((state) => ({
          plans: {
            ...state.plans,
            [planKey(plan)]: plan,
          },
        })),
    }),
    {
      name: "paseo.plans",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ plans: state.plans }),
    },
  ),
);

export function usePlan(input: {
  serverId: string;
  workspaceId: string;
  path: string;
}): PlanRecord | null {
  return usePlanStore((state) => state.plans[planKey(input)] ?? null);
}
