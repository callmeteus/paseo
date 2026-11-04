import { afterEach, describe, expect, it } from "vitest";
import {
  clearSidebarReveal,
  getSidebarRevealRequest,
  isSidebarRevealExpired,
  requestSidebarReveal,
  resetSidebarReveal,
  resolveSidebarScrollTarget,
  workspaceKeyForSidebarRow,
} from "@/components/sidebar/sidebar-reveal";

afterEach(() => {
  resetSidebarReveal();
});

describe("resolveSidebarScrollTarget", () => {
  const viewport = { viewportTop: 100, viewportHeight: 400, offsetY: 500 };

  it("leaves a row that is already fully visible alone", () => {
    expect(resolveSidebarScrollTarget({ ...viewport, rowTop: 160, rowHeight: 40 })).toBeNull();
  });

  it("scrolls up to a row above the viewport", () => {
    // The visible band starts at 112; the row starts 72 points above it.
    expect(resolveSidebarScrollTarget({ ...viewport, rowTop: 40, rowHeight: 40 })).toBe(428);
  });

  it("scrolls down to a row below the viewport", () => {
    // The visible band ends at 488; the row ends 152 points past it.
    expect(resolveSidebarScrollTarget({ ...viewport, rowTop: 600, rowHeight: 40 })).toBe(652);
  });

  it("tops a row taller than the viewport instead of hiding its title", () => {
    expect(resolveSidebarScrollTarget({ ...viewport, rowTop: 300, rowHeight: 600 })).toBe(912);
  });

  it("never scrolls past the start of the list", () => {
    expect(
      resolveSidebarScrollTarget({
        viewportTop: 100,
        viewportHeight: 400,
        offsetY: 20,
        rowTop: 40,
        rowHeight: 40,
      }),
    ).toBe(0);
  });

  it("honors a caller margin", () => {
    expect(
      resolveSidebarScrollTarget({ ...viewport, rowTop: 108, rowHeight: 10, margin: 8 }),
    ).toBeNull();
  });
});

describe("sidebar reveal requests", () => {
  it("keys rows the way the sidebar does", () => {
    expect(workspaceKeyForSidebarRow({ serverId: "srv_a", workspaceId: "ws_1" })).toBe(
      "srv_a:ws_1",
    );
  });

  it("publishes a new request and clears only the current one", () => {
    requestSidebarReveal("srv_a:ws_1");
    const first = getSidebarRevealRequest();
    expect(first?.workspaceKey).toBe("srv_a:ws_1");

    requestSidebarReveal("srv_a:ws_2");
    const second = getSidebarRevealRequest();
    expect(second?.workspaceKey).toBe("srv_a:ws_2");
    expect(second?.nonce).not.toBe(first?.nonce);

    clearSidebarReveal(first!.nonce);
    expect(getSidebarRevealRequest()?.workspaceKey).toBe("srv_a:ws_2");

    clearSidebarReveal(second!.nonce);
    expect(getSidebarRevealRequest()).toBeNull();
  });

  it("ignores an empty workspace key", () => {
    requestSidebarReveal("");
    expect(getSidebarRevealRequest()).toBeNull();
  });

  it("expires a request the sidebar never consumed", () => {
    requestSidebarReveal("srv_a:ws_1");
    const request = getSidebarRevealRequest();
    expect(request).not.toBeNull();
    expect(isSidebarRevealExpired({ ...request!, requestedAt: Date.now() - 10_000 })).toBe(true);
    expect(isSidebarRevealExpired(request!)).toBe(false);
  });
});
