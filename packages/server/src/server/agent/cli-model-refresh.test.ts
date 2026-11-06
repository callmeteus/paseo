import { describe, expect, test, vi } from "vitest";

import {
  cliHelpListsModelsCommand,
  cursorModelsArgv,
  modelsSubcommandArgs,
  refreshCliThenRead,
} from "./cli-model-refresh.js";
import { resolveCursorCliCommand } from "./providers/cursor-mcp-auth.js";

const CLAUDE_HELP_WITHOUT_MODELS = `
Usage: claude [options] [command] [prompt]

Options:
  --model <model>                       Model for the current session.

Commands:
  agents [options]                      Manage background agents
                                        terminal. The word models appears here only.
  auth                                  Manage authentication
  mcp                                   Configure and manage MCP servers

Options:
  -h, --help                            Display help for command
`;

describe("refreshCliThenRead", () => {
  test("asks the CLI before reading the catalog", async () => {
    const order: string[] = [];
    const catalog = await refreshCliThenRead({
      refreshCli: async () => {
        order.push("cli");
      },
      read: async () => {
        order.push("read");
        return ["opencode/deepseek-v4.1-flash-free"];
      },
    });

    expect(order).toEqual(["cli", "read"]);
    expect(catalog).toEqual(["opencode/deepseek-v4.1-flash-free"]);
  });

  test("still reads when the CLI refresh fails", async () => {
    const read = vi.fn(async () => ["kept"]);
    const onRefreshError = vi.fn();

    await expect(
      refreshCliThenRead({
        refreshCli: async () => {
          throw new Error("opencode models failed");
        },
        read,
        onRefreshError,
      }),
    ).resolves.toEqual(["kept"]);

    expect(onRefreshError).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("reads when the CLI has no refresh command", async () => {
    const read = vi.fn(async () => ["from-catalog"]);

    await expect(refreshCliThenRead({ refreshCli: null, read })).resolves.toEqual(["from-catalog"]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("propagates a failed read so the caller can keep the previous catalog", async () => {
    await expect(
      refreshCliThenRead({
        refreshCli: async () => {
          throw new Error("cli down");
        },
        read: async () => {
          throw new Error("read failed");
        },
      }),
    ).rejects.toThrow("read failed");
  });

  test("does not continue the read after the refresh deadline aborts", async () => {
    const controller = new AbortController();
    const read = vi.fn(async () => ["late"]);
    controller.abort(new Error("timed out"));

    await expect(
      refreshCliThenRead({
        signal: controller.signal,
        refreshCli: async () => {
          throw controller.signal.reason;
        },
        read,
      }),
    ).rejects.toThrow("timed out");
    expect(read).not.toHaveBeenCalled();
  });
});

describe("cliHelpListsModelsCommand", () => {
  test("does not treat Claude Code help without a models command as a models command", () => {
    expect(cliHelpListsModelsCommand(CLAUDE_HELP_WITHOUT_MODELS)).toBe(false);
  });

  test("recognizes a models command and a models alias", () => {
    expect(
      cliHelpListsModelsCommand(`
Commands:
  models                                List available models
`),
    ).toBe(true);
    expect(
      cliHelpListsModelsCommand(`
Commands:
  model|models                          List available models
`),
    ).toBe(true);
  });
});

describe("model command argv", () => {
  test("appends models unless the argv is already a server or ACP subcommand", () => {
    expect(modelsSubcommandArgs([])).toEqual(["models"]);
    expect(modelsSubcommandArgs(["script.js"])).toEqual(["script.js", "models"]);
    expect(modelsSubcommandArgs(["serve"])).toBeNull();
    expect(modelsSubcommandArgs(["--port", "4096", "serve"])).toBeNull();
    expect(modelsSubcommandArgs(["models"])).toEqual(["models"]);
  });

  test("asks cursor-agent and agent for models after the acp launcher is removed", () => {
    expect(cursorModelsArgv(resolveCursorCliCommand(["cursor-agent", "acp"]))).toEqual({
      command: "cursor-agent",
      args: ["models"],
    });
    expect(cursorModelsArgv(resolveCursorCliCommand(["agent", "acp"]))).toEqual({
      command: "agent",
      args: ["models"],
    });
  });
});
