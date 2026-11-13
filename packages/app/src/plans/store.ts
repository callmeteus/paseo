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
  /** Plan keys with a build in flight. Runtime-only: never persisted. */
  building: Record<string, true>;
  setPlan: (plan: PlanRecord) => void;
  setBuilding: (
    input: { serverId: string; workspaceId: string; path: string },
    building: boolean,
  ) => void;
}

function normalizePlanPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
}

export function planKey(input: { serverId: string; workspaceId: string; path: string }): string {
  return `${input.serverId}:${input.workspaceId}:${normalizePlanPath(input.path)}`;
}

export const usePlanStore = create<PlanStore>()(
  persist(
    (set) => ({
      plans: {},
      building: {},
      setPlan: (plan) =>
        set((state) => ({
          plans: {
            ...state.plans,
            [planKey(plan)]: plan,
          },
        })),
      setBuilding: (input, building) =>
        set((state) => {
          const key = planKey(input);
          if (building === Boolean(state.building[key])) return state;
          const next = { ...state.building };
          if (building) next[key] = true;
          else delete next[key];
          return { building: next };
        }),
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
  const path = normalizePlanPath(input.path);
  return usePlanStore(
    (state) =>
      Object.values(state.plans).find(
        (plan) => plan.serverId === input.serverId && normalizePlanPath(plan.path) === path,
      ) ?? null,
  );
}

/** True while the daemon reports a build in flight for this plan. */
export function usePlanBuilding(input: {
  serverId: string;
  workspaceId: string;
  path: string;
}): boolean {
  return usePlanStore((state) => Boolean(state.building[planKey(input)]));
}
