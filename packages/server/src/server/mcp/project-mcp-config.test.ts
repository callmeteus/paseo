import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readProjectMcpConfigs } from "./project-mcp-config";

describe("readProjectMcpConfigs", () => {
  it("reads Cursor's project MCP servers with ${workspaceFolder} resolved", () => {
    const root = mkdtempSync(path.join(tmpdir(), "paseo-cursor-mcp-"));
    try {
      mkdirSync(path.join(root, ".cursor"));
      writeFileSync(
        path.join(root, ".cursor", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            demo: {
              type: "stdio",
              command: "bash",
              args: ["${workspaceFolder}/scripts/run.sh"],
            },
          },
        }),
      );
      expect(readProjectMcpConfigs(root)).toEqual({
        demo: { type: "stdio", command: "bash", args: [path.join(root, "scripts/run.sh")] },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns nothing when the project has no Cursor MCP config", () => {
    const root = mkdtempSync(path.join(tmpdir(), "paseo-no-mcp-"));
    try {
      expect(readProjectMcpConfigs(root)).toEqual({});
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
