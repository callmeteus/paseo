import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { planKey, usePlanStore } from "@/plans/store";

describe("plan store building state", () => {
  const plan = {
    serverId: "server-1",
    workspaceId: "workspace-1",
    path: "plans/feature.md",
  };

  beforeEach(() => {
    usePlanStore.setState({ plans: {}, building: {} });
  });

  it("marks a plan as building and clears it afterwards", () => {
    usePlanStore.getState().setBuilding(plan, true);
    expect(usePlanStore.getState().building[planKey(plan)]).toBe(true);

    usePlanStore.getState().setBuilding(plan, false);
    expect(usePlanStore.getState().building[planKey(plan)]).toBeUndefined();
  });

  it("tracks plans independently", () => {
    usePlanStore.getState().setBuilding(plan, true);

    expect(usePlanStore.getState().building[planKey({ ...plan, path: "plans/other.md" })]).toBe(
      undefined,
    );
    expect(
      usePlanStore.getState().building[planKey({ ...plan, workspaceId: "workspace-2" })],
    ).toBeUndefined();
  });

  it("normalizes the path before keying the build", () => {
    usePlanStore.getState().setBuilding({ ...plan, path: "./plans/feature.md" }, true);

    expect(usePlanStore.getState().building[planKey(plan)]).toBe(true);
  });

  it("keeps a repeated clear from replacing store state", () => {
    usePlanStore.getState().setBuilding(plan, true);
    const building = usePlanStore.getState().building;

    usePlanStore.getState().setBuilding(plan, false);
    usePlanStore.getState().setBuilding(plan, false);

    expect(usePlanStore.getState().building).not.toBe(building);
    expect(usePlanStore.getState().building).toEqual({});
  });
});
