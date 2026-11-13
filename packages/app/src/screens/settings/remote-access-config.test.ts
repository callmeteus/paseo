import { describe, expect, it } from "vitest";
import {
  createRemoteAccessPatch,
  formatAllowlist,
  parseAllowlist,
  readRemoteAccess,
  toggleRemotePeer,
} from "./remote-access-config";

describe("remote access config", () => {
  it("resolves fully-off defaults when the host has no settings", () => {
    const config = readRemoteAccess(null);
    expect(config.inbound.enabled).toBe(false);
    expect(config.outbound.enabled).toBe(false);
    expect(config.inbound.peers).toEqual([]);
    expect(config.outbound.files).toBe("off");
  });

  it("toggles peers without mutating the scope", () => {
    const config = readRemoteAccess(null);
    const added = toggleRemotePeer(config.outbound, "srv_b");
    expect(added.peers).toEqual(["srv_b"]);
    expect(config.outbound.peers).toEqual([]);
    const removed = toggleRemotePeer(added, "srv_b");
    expect(removed.peers).toEqual([]);
  });

  it("builds a patch that keeps both directions", () => {
    const config = readRemoteAccess(null);
    const patch = createRemoteAccessPatch(config, "inbound", {
      enabled: true,
      peers: ["srv_a"],
    });
    expect(patch.remoteAccess?.inbound?.enabled).toBe(true);
    expect(patch.remoteAccess?.outbound?.enabled).toBe(false);
  });

  it("parses and formats the command allowlist", () => {
    expect(parseAllowlist("git\n npm, git \n\n")).toEqual(["git", "npm"]);
    expect(formatAllowlist(["git", "npm"])).toBe("git\nnpm");
  });
});
