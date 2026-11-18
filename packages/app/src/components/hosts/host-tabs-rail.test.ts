import { describe, expect, it } from "vitest";
import { isHostTabsRailVisible } from "./host-tabs-rail";

describe("isHostTabsRailVisible", () => {
  it("shows the rail only when hosts are grouped into tabs and there is more than one", () => {
    expect(isHostTabsRailVisible({ groupMode: "host_tabs", hostCount: 2 })).toBe(true);
    expect(isHostTabsRailVisible({ groupMode: "host_tabs", hostCount: 1 })).toBe(false);
    expect(isHostTabsRailVisible({ groupMode: "project", hostCount: 2 })).toBe(false);
  });
});
