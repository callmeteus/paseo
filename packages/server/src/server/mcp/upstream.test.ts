import { describe, expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import type { McpServerConfig } from "@getpaseo/protocol/messages";
import { UpstreamMcpRegistry } from "./upstream.js";

const fixture = fileURLToPath(new URL("./test-fixtures/echo-mcp-server.mjs", import.meta.url));

describe("UpstreamMcpRegistry", () => {
  test("connects to a stdio MCP server, lists tools and calls one", async () => {
    const servers: Record<string, McpServerConfig> = {
      echo: {
        type: "stdio",
        command: process.execPath,
        args: [fixture],
      },
    };
    const registry = new UpstreamMcpRegistry({ getServers: () => servers });
    try {
      await expect(registry.listTools("echo")).resolves.toEqual([
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
      await expect(registry.callTool("echo", "echo", { text: "hello" })).resolves.toEqual({
        content: [{ type: "text", text: "hello" }],
      });
    } finally {
      await registry.close();
    }
  }, 20_000);

  test("reports an unknown server without spawning anything", async () => {
    const registry = new UpstreamMcpRegistry({ getServers: () => ({}) });
    await expect(registry.listTools("missing")).rejects.toThrow('Unknown MCP server "missing"');
    await registry.close();
  });
});
