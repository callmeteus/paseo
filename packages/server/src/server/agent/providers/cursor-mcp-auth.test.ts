import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, test } from "vitest";

import { cursorCliEnv, parseCursorMcpList, resolveCursorCliCommand } from "./cursor-mcp-auth.js";

describe("Cursor MCP auth", () => {
  test("resolves the CLI from the ACP command", () => {
    expect(resolveCursorCliCommand(["cursor-agent", "acp"])).toEqual(["cursor-agent"]);
    expect(resolveCursorCliCommand(["cursor-agent", "--use-system-ca", "index.js", "acp"])).toEqual(
      ["cursor-agent", "--use-system-ca", "index.js"],
    );
  });

  test("adds the user bin directories to the CLI PATH", () => {
    const env = cursorCliEnv({ PATH: "/usr/bin" });
    expect(env.PATH?.split(delimiter).slice(0, 2)).toEqual([
      join(homedir(), ".local", "bin"),
      join(homedir(), ".npm-global", "bin"),
    ]);
    expect(env.PATH?.split(delimiter)).toContain("/usr/bin");
  });

  test("parses statuses from cursor-agent mcp list", () => {
    expect(
      parseCursorMcpList(
        [
          "luckymaker-prod: ready",
          "Mobbin: requires_authentication",
          "slack: not loaded (needs approval)",
          "rea: Error: Connection failed",
          "mystery: something else",
        ].join("\n"),
      ),
    ).toEqual([
      { name: "luckymaker-prod", status: "ready" },
      { name: "Mobbin", status: "needs_auth" },
      { name: "slack", status: "needs_approval", detail: "not loaded (needs approval)" },
      { name: "rea", status: "error", detail: "Connection failed" },
      { name: "mystery", status: "unknown", detail: "something else" },
    ]);
  });
});
