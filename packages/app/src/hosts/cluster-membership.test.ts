import { describe, expect, it } from "vitest";
import { hostExclusionList, hostIsAnnounced, hostSyncsName } from "./cluster-membership";

const prefs = {
  autoSyncNames: true,
  announceHosts: true,
  syncExcluded: ["srv_skip"],
  announceExcluded: ["srv_quiet"],
};

describe("cluster membership", () => {
  it("includes every host until one is left out", () => {
    expect(hostSyncsName(prefs, "srv_keep")).toBe(true);
    expect(hostSyncsName(prefs, "srv_skip")).toBe(false);
    expect(hostSyncsName({ ...prefs, autoSyncNames: false }, "srv_keep")).toBe(false);
    expect(hostIsAnnounced(prefs, "srv_keep")).toBe(true);
    expect(hostIsAnnounced(prefs, "srv_quiet")).toBe(false);
    expect(hostIsAnnounced({ ...prefs, announceHosts: false }, "srv_keep")).toBe(false);
  });

  it("records an exclusion and clears it when the host is included again", () => {
    const excluded = hostExclusionList([], { serverId: "srv_skip", include: false });
    expect(excluded).toEqual(["srv_skip"]);
    expect(hostExclusionList(excluded, { serverId: "srv_skip", include: false })).toEqual([
      "srv_skip",
    ]);
    expect(hostExclusionList(excluded, { serverId: "srv_skip", include: true })).toEqual([]);
    expect(hostExclusionList([], { serverId: "srv_keep", include: true })).toEqual([]);
  });
});
