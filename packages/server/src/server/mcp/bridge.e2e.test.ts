import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { createHostClient } from "@getpaseo/client/node";
import { createPaseoApi } from "@getpaseo/client";
import { ConnectedHosts } from "../connected-hosts/index.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { McpBridgeManager } from "./bridge.js";

const fixture = fileURLToPath(new URL("./test-fixtures/echo-mcp-server.mjs", import.meta.url));

describe("McpBridgeManager", () => {
  test("exposes configured bridges as local HTTP MCP servers for agents", () => {
    const manager = new McpBridgeManager({
      hosts: {} as never,
      selfServerId: "self",
      getBridges: () => ({ echo: { host: "owner", server: "echo" } }),
    });
    manager.setBaseUrl("http://127.0.0.1:17000");
    manager.setAuthToken("token");

    expect(manager.getAgentMcpServers("agent-1")).toEqual({
      echo: {
        type: "http",
        url: "http://127.0.0.1:17000/mcp/bridge/echo?callerAgentId=agent-1",
        headers: { Authorization: "Bearer token" },
      },
    });
  });

  test("bridges a stdio MCP server from another host over the Paseo link", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-mcp-bridge-"));
    const owner = await createTestPaseoDaemon({
      mcpServers: {
        echo: { type: "stdio", command: process.execPath, args: [fixture] },
      },
    });
    const consumer = await createTestPaseoDaemon();
    const hosts = new ConnectedHosts(home, {
      serverId: consumer.daemon.getServerId(),
      label: "consumer",
    });
    const ownerClient = createHostClient(`127.0.0.1:${owner.port}`, {
      clientId: crypto.randomUUID(),
      reconnect: { enabled: false },
    });
    try {
      await ownerClient.connect();
      const consumerId = (await hosts.list()).self.serverId;
      await ownerClient.patchDaemonConfig({
        mcpShares: { echo: { hosts: [consumerId] } },
      });
      const ownerId = owner.daemon.getServerId();
      await hosts.add(
        { connection: `127.0.0.1:${owner.port}`, label: "owner" },
        { sourceId: "test", manageSources: true },
      );
      await waitForOnline(() => hosts.list());
      const manager = new McpBridgeManager({
        hosts,
        selfServerId: consumerId,
        getBridges: () => ({ echo: { host: ownerId, server: "echo" } }),
      });
      await expect(manager.listTools("echo")).resolves.toEqual([
        {
          name: "echo",
          description: "Echo the provided text",
          inputSchema: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          },
        },
      ]);
      await expect(manager.callTool("echo", "echo", { text: "hello" })).resolves.toEqual({
        content: [{ type: "text", text: "hello" }],
      });
    } finally {
      await ownerClient.close();
      await hosts.close();
      await consumer.close();
      await owner.close();
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);

  test("bridges through an intermediate host with an explicit via", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-mcp-bridge-hop-"));
    const owner = await createTestPaseoDaemon({
      mcpServers: {
        echo: { type: "stdio", command: process.execPath, args: [fixture] },
      },
    });
    const via = await createTestPaseoDaemon();
    const consumer = await createTestPaseoDaemon();
    const ownerClient = createHostClient(`127.0.0.1:${owner.port}`, {
      clientId: crypto.randomUUID(),
      reconnect: { enabled: false },
    });
    const viaClient = createHostClient(`127.0.0.1:${via.port}`, {
      clientId: crypto.randomUUID(),
      reconnect: { enabled: false },
    });
    const hosts = new ConnectedHosts(home, {
      serverId: consumer.daemon.getServerId(),
      label: "consumer",
    });
    try {
      await ownerClient.connect();
      await viaClient.connect();
      const consumerId = (await hosts.list()).self.serverId;
      await ownerClient.patchDaemonConfig({
        mcpShares: { echo: { hosts: [consumerId] } },
      });
      const ownerId = owner.daemon.getServerId();
      const viaId = via.daemon.getServerId();
      const viaApi = createPaseoApi(viaClient);
      await viaApi.hosts.add({
        connection: `127.0.0.1:${owner.port}`,
        label: "owner",
      });
      await waitForOnline(() => viaApi.hosts.list());
      await hosts.add(
        { connection: `127.0.0.1:${via.port}`, label: "via" },
        { sourceId: "test", manageSources: true },
      );
      await waitForOnline(() => hosts.list());
      const manager = new McpBridgeManager({
        hosts,
        selfServerId: consumerId,
        getBridges: () => ({
          echo: { host: ownerId, via: viaId, server: "echo" },
        }),
      });
      await expect(manager.callTool("echo", "echo", { text: "two hops" })).resolves.toEqual({
        content: [{ type: "text", text: "two hops" }],
      });
    } finally {
      await viaClient.close();
      await ownerClient.close();
      await hosts.close();
      await consumer.close();
      await via.close();
      await owner.close();
      rmSync(home, { recursive: true, force: true });
    }
  }, 40_000);
});

async function waitForOnline(
  list: () => Promise<{ hosts: Array<{ status: string }> }>,
): Promise<void> {
  await waitFor(async () => {
    const directory = await list();
    return directory.hosts.some((host) => host.status === "online");
  });
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for condition");
}
