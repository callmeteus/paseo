import { describe, expect, it } from "vitest";
import {
  McpBridgeCallToolRequestSchema,
  McpBridgeCallToolResponseSchema,
  McpBridgeListServersRequestSchema,
  McpBridgeListServersResponseSchema,
  McpBridgeListToolsRequestSchema,
  McpBridgeListToolsResponseSchema,
} from "./rpc-schemas.js";

describe("MCP bridge RPC schemas", () => {
  it("parses the list, tools, and call messages the session emits", () => {
    expect(
      McpBridgeListServersRequestSchema.parse({
        type: "mcp.bridge.list_servers.request",
        requestId: "req-1",
      }),
    ).toEqual({ type: "mcp.bridge.list_servers.request", requestId: "req-1" });

    expect(
      McpBridgeListServersResponseSchema.parse({
        type: "mcp.bridge.list_servers.response",
        payload: {
          requestId: "req-1",
          servers: [{ server: "local", description: "Local server", tools: ["echo"] }],
          error: null,
        },
      }).payload.servers,
    ).toEqual([{ server: "local", description: "Local server", tools: ["echo"] }]);

    expect(
      McpBridgeListToolsRequestSchema.parse({
        type: "mcp.bridge.list_tools.request",
        requestId: "req-2",
        server: "local",
      }).server,
    ).toBe("local");

    expect(
      McpBridgeListToolsResponseSchema.parse({
        type: "mcp.bridge.list_tools.response",
        payload: {
          requestId: "req-2",
          server: "local",
          tools: [{ name: "echo", description: "Echo the text", inputSchema: { type: "object" } }],
          error: "MCP bridge is unavailable",
        },
      }).payload,
    ).toMatchObject({
      tools: [{ name: "echo", description: "Echo the text", inputSchema: { type: "object" } }],
      error: "MCP bridge is unavailable",
    });

    expect(
      McpBridgeCallToolRequestSchema.parse({
        type: "mcp.bridge.call_tool.request",
        requestId: "req-3",
        server: "local",
        tool: "echo",
      }).arguments,
    ).toBeUndefined();

    expect(
      McpBridgeCallToolResponseSchema.parse({
        type: "mcp.bridge.call_tool.response",
        payload: {
          requestId: "req-3",
          server: "local",
          tool: "echo",
          result: { ok: true },
          error: null,
        },
      }).payload.result,
    ).toEqual({ ok: true });
  });

  it("rejects empty bridge names", () => {
    expect(() =>
      McpBridgeListToolsRequestSchema.parse({
        type: "mcp.bridge.list_tools.request",
        requestId: "req-4",
        server: "",
      }),
    ).toThrow();
  });
});
