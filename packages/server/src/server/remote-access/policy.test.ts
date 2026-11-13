import { describe, expect, it } from "vitest";
import { RemoteAccessConfigSchema } from "@getpaseo/protocol/remote-access";
import {
  DaemonConfigRemoteAccessPolicy,
  resolveRemoteAccessConfig,
  StaticRemoteAccessPolicy,
} from "./policy.js";

function scope(overrides: Record<string, unknown> = {}) {
  return RemoteAccessConfigSchema.parse({ inbound: overrides });
}

describe("remote access policy", () => {
  it("is off by default in both directions", () => {
    const policy = new StaticRemoteAccessPolicy(resolveRemoteAccessConfig(undefined));
    expect(policy.allowsInbound("srv_a", "files.read")).toBe(false);
    expect(policy.allowsOutbound("srv_a", "commands")).toBe(false);
    expect(policy.scope("inbound").commands.mode).toBe("any");
    expect(policy.scope("inbound").restrictToWorkspaces).toBe(true);
  });

  it("requires the peer to be listed", () => {
    const policy = new StaticRemoteAccessPolicy(scope({ enabled: true, peers: [], files: "read" }));
    expect(policy.allowsInbound("srv_a", "files.read")).toBe(false);
    expect(policy.inboundDecision("srv_a", "files.read").reason).toContain("not an allowed peer");
  });

  it("maps file levels to capabilities", () => {
    const readOnly = new StaticRemoteAccessPolicy(
      scope({ enabled: true, peers: ["srv_a"], files: "read" }),
    );
    expect(readOnly.allowsInbound("srv_a", "files.read")).toBe(true);
    expect(readOnly.allowsInbound("srv_a", "files.write")).toBe(false);

    const write = new StaticRemoteAccessPolicy(
      scope({ enabled: true, peers: ["srv_a"], files: "write" }),
    );
    expect(write.allowsInbound("srv_a", "files.read")).toBe(true);
    expect(write.allowsInbound("srv_a", "files.write")).toBe(true);
  });

  it("gates chats and agents separately", () => {
    const policy = new StaticRemoteAccessPolicy(
      scope({ enabled: true, peers: ["srv_a"], chats: true, agents: false }),
    );
    expect(policy.allowsInbound("srv_a", "chats")).toBe(true);
    expect(policy.allowsInbound("srv_a", "agents")).toBe(false);
  });

  it("matches the command allowlist by executable name", () => {
    const policy = new StaticRemoteAccessPolicy(
      RemoteAccessConfigSchema.parse({
        inbound: {
          enabled: true,
          peers: ["srv_a"],
          commands: { mode: "allowlist", allowlist: ["git", "/usr/bin/npm"] },
        },
      }),
    );
    expect(policy.commandAllowed("inbound", "git")).toBe(true);
    expect(policy.commandAllowed("inbound", "/usr/local/bin/git")).toBe(true);
    expect(policy.commandAllowed("inbound", "npm")).toBe(true);
    expect(policy.commandAllowed("inbound", "rm")).toBe(false);
  });

  it("honors any mode and the workspace restriction", () => {
    const policy = new StaticRemoteAccessPolicy(
      scope({
        enabled: true,
        peers: ["srv_a"],
        commands: { mode: "any" },
        restrictToWorkspaces: false,
      }),
    );
    expect(policy.commandAllowed("inbound", "anything")).toBe(true);
    expect(policy.restrictsToWorkspaces("inbound")).toBe(false);
  });

  it("reads live daemon config", () => {
    let config: Record<string, unknown> = {};
    const policy = new DaemonConfigRemoteAccessPolicy({
      get: () =>
        ({
          remoteAccess: config.remoteAccess,
        }) as never,
    });
    expect(policy.allowsInbound("srv_a", "files.read")).toBe(false);
    config = { remoteAccess: { inbound: { enabled: true, peers: ["srv_a"], files: "read" } } };
    expect(policy.allowsInbound("srv_a", "files.read")).toBe(true);
  });
});
