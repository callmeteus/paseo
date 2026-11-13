import { describe, expect, test } from "vitest";
import { SharedMcpAuthority } from "./authority.js";
import type { UpstreamMcpRegistry } from "./upstream.js";

function registry(tools: Array<{ name: string; inputSchema: unknown }>) {
  return {
    listTools: async () => tools,
    callTool: async (serverName: string, toolName: string) => ({ serverName, toolName }),
  } as unknown as UpstreamMcpRegistry;
}

describe("SharedMcpAuthority", () => {
  test("lists only servers shared with the origin host", async () => {
    const authority = new SharedMcpAuthority(registry([]), () => ({
      docs: { hosts: ["host-a"] },
      private: { hosts: ["host-b"] },
    }));

    await expect(authority.listServers({ originServerId: "host-a" })).resolves.toEqual([
      { server: "docs" },
    ]);
  });

  test("filters tools by the configured allowlist", async () => {
    const authority = new SharedMcpAuthority(
      registry([
        { name: "search", inputSchema: {} },
        { name: "write", inputSchema: {} },
      ]),
      () => ({ docs: { hosts: ["host-a"], tools: ["search"] } }),
    );

    await expect(
      authority.listTools({ serverName: "docs", originServerId: "host-a" }),
    ).resolves.toEqual([{ name: "search", inputSchema: {} }]);
  });

  test("rejects a tool outside the allowlist", async () => {
    const authority = new SharedMcpAuthority(registry([]), () => ({
      docs: { hosts: ["host-a"], tools: ["search"] },
    }));

    await expect(
      authority.callTool({
        serverName: "docs",
        toolName: "write",
        arguments: {},
        originServerId: "host-a",
      }),
    ).rejects.toThrow('Tool "write" is not shared');
  });

  test("rejects a host that is not in the allowlist", async () => {
    const authority = new SharedMcpAuthority(registry([]), () => ({
      docs: { hosts: ["host-a"] },
    }));

    await expect(
      authority.callTool({
        serverName: "docs",
        toolName: "search",
        arguments: {},
        originServerId: "host-b",
      }),
    ).rejects.toThrow("is not shared with this host");
  });
});
