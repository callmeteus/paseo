import { describe, expect, test } from "vitest";
import { isPreapprovedAcpMcpTool } from "./acp-tool-policy.js";

const hubPolicy = {
  preapproved: [
    { kind: "mcp" as const, server: "hub", tool: "finish_execution" },
    { kind: "mcp" as const, server: "hub", tool: "reply" },
  ],
};

describe("ACP exact MCP preapproval", () => {
  test("approves the unqualified Cursor title for one granted tool", () => {
    expect(
      isPreapprovedAcpMcpTool({
        title: "finish_execution: finish_execution",
        kind: "other",
        toolPolicy: hubPolicy,
      }),
    ).toBe(true);
  });

  test("approves a title that already names the MCP server", () => {
    expect(
      isPreapprovedAcpMcpTool({
        title: "hub: reply",
        kind: "other",
        toolPolicy: hubPolicy,
      }),
    ).toBe(true);
  });

  test("leaves shell, unknown tools, and ambiguous names for the user", () => {
    expect(
      isPreapprovedAcpMcpTool({
        title: "`rm -rf /`",
        kind: "execute",
        toolPolicy: hubPolicy,
      }),
    ).toBe(false);
    expect(
      isPreapprovedAcpMcpTool({
        title: undefined,
        kind: "other",
        toolPolicy: hubPolicy,
      }),
    ).toBe(false);
    expect(
      isPreapprovedAcpMcpTool({
        title: "delete_file: delete_file",
        kind: "other",
        toolPolicy: hubPolicy,
      }),
    ).toBe(false);
    expect(
      isPreapprovedAcpMcpTool({
        title: "finish_execution: finish_execution",
        kind: "other",
        toolPolicy: {
          preapproved: [
            { kind: "mcp", server: "hub", tool: "finish_execution" },
            { kind: "mcp", server: "other", tool: "finish_execution" },
          ],
        },
      }),
    ).toBe(false);
  });
});
