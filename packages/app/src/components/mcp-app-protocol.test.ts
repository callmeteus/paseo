import { describe, expect, it } from "vitest";
import { mcpAppHostMessages } from "./mcp-app-protocol";

describe("mcpAppHostMessages", () => {
  it("answers ui/initialize with the tool call the host already has", () => {
    expect(
      mcpAppHostMessages(
        { jsonrpc: "2.0", id: 7, method: "ui/initialize" },
        { name: "lm_prod_ssh_grant", input: { action: "grant" }, result: { success: true } },
      ),
    ).toEqual([
      {
        jsonrpc: "2.0",
        id: 7,
        result: {
          hostContext: {
            toolInfo: {
              tool: { name: "lm_prod_ssh_grant", originalName: "lm_prod_ssh_grant" },
            },
            theme: "dark",
          },
        },
      },
      {
        jsonrpc: "2.0",
        method: "ui/notifications/tool-input",
        params: { arguments: { action: "grant" } },
      },
      {
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: { success: true },
      },
    ]);
  });

  it("ignores unrelated messages", () => {
    expect(
      mcpAppHostMessages({ hello: true }, { name: "x", input: null, result: null }),
    ).toBeNull();
  });
});
