import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "vitest";
import { createBridgeMcpServer } from "./bridge-mcp-server.js";
import type { McpBridgeManager } from "../mcp/bridge.js";

function manager(): McpBridgeManager {
  return {
    listTools: async () => [
      {
        name: "search",
        description: "Search docs",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
      },
    ],
    callTool: async (_bridgeName: string, toolName: string) => ({
      content: [{ type: "text", text: `called ${toolName}` }],
    }),
  } as unknown as McpBridgeManager;
}

describe("createBridgeMcpServer", () => {
  test("proxies tools/list and tools/call through the manager", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = await createBridgeMcpServer({ bridgeName: "docs", manager: manager() });
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientTransport);

    await expect(client.listTools()).resolves.toEqual({
      tools: [
        {
          name: "search",
          description: "Search docs",
          inputSchema: { type: "object", properties: { query: { type: "string" } } },
        },
      ],
    });
    await expect(client.callTool({ name: "search", arguments: { query: "x" } })).resolves.toEqual({
      content: [{ type: "text", text: "called search" }],
    });

    await client.close();
    await server.close();
  });
});
