import { describe, expect, it } from "vitest";
import { resolveActiveHostServerId } from "../utils/active-host";

describe("resolveActiveHostServerId", () => {
  it("uses the pinned host tab when one is selected", () => {
    expect(
      resolveActiveHostServerId({
        hostFilters: ["srv-pinned"],
        pathname: "/h/srv-route/workspace/ws-1",
        lastServerId: "srv-last",
      }),
    ).toBe("srv-pinned");
  });

  it("uses the host route when no tab is pinned", () => {
    expect(
      resolveActiveHostServerId({
        hostFilters: [],
        pathname: "/h/srv-route/workspace/ws-1",
        lastServerId: "srv-last",
      }),
    ).toBe("srv-route");
  });

  it("falls back to the last opened workspace host outside a host route", () => {
    expect(
      resolveActiveHostServerId({
        hostFilters: [],
        pathname: "/",
        lastServerId: "srv-last",
      }),
    ).toBe("srv-last");
  });

  it("returns null when no host is in focus", () => {
    expect(
      resolveActiveHostServerId({ hostFilters: [], pathname: "/", lastServerId: null }),
    ).toBeNull();
  });

  it("ignores the last workspace host when multiple tabs are pinned", () => {
    expect(
      resolveActiveHostServerId({
        hostFilters: ["srv-a", "srv-b"],
        pathname: "/h/srv-route",
        lastServerId: "srv-last",
      }),
    ).toBe("srv-route");
  });
});
