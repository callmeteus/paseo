import { describe, expect, it } from "vitest";
import { RemoteAccessConfigSchema } from "@getpaseo/protocol/remote-access";
import { StaticRemoteAccessPolicy } from "../../remote-access/policy.js";
import type { RemoteActions } from "../host-operations/remote-actions.js";
import { hasRemoteToolsConfigured, registerRemoteTools } from "./remote-tools.js";

function policy(overrides: Record<string, unknown>) {
  return new StaticRemoteAccessPolicy(RemoteAccessConfigSchema.parse({ outbound: overrides }));
}

function unusedActions(): RemoteActions {
  const fail = () => Promise.reject(new Error("action should not run"));
  return {
    listFiles: fail,
    readFile: fail,
    searchFiles: fail,
    writeFile: fail,
    editFile: fail,
    runCommand: fail,
  };
}

describe("remote tools", () => {
  it("reports nothing configured by default", () => {
    expect(hasRemoteToolsConfigured(policy({}))).toBe(false);
  });

  it("reports configured when a capability is on", () => {
    expect(hasRemoteToolsConfigured(policy({ enabled: true, files: "read" }))).toBe(true);
    expect(hasRemoteToolsConfigured(policy({ enabled: true, commands: { mode: "any" } }))).toBe(
      true,
    );
  });

  it("registers the six remote tools", () => {
    const names: string[] = [];
    registerRemoteTools({
      register: (name) => names.push(name),
      actions: unusedActions(),
      policy: () => policy({ enabled: true, files: "write" }),
    });
    expect(names).toEqual([
      "list_remote_files",
      "read_remote_file",
      "search_remote_files",
      "write_remote_file",
      "edit_remote_file",
      "run_remote_command",
    ]);
  });

  it("refuses commands when the outbound mode is off", async () => {
    let handler: ((input: Record<string, unknown>) => Promise<unknown>) | null = null;
    registerRemoteTools({
      register: (name, _config, registered) => {
        if (name === "run_remote_command") handler = registered;
      },
      actions: unusedActions(),
      policy: () => policy({ enabled: true, commands: { mode: "off" } }),
    });
    expect(handler).not.toBeNull();
    await expect(
      handler!({ serverId: "srv_b", workspaceId: "ws", command: "git" }),
    ).rejects.toThrow("off");
  });
});
