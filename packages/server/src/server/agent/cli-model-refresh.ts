/**
 * Asks a CLI to refresh its own model list, then reads the catalog Paseo
 * already stores. This is not a second catalog: the CLI command only updates
 * the tool, and `read` is the existing discovery path.
 *
 * OpenCode runs `opencode models`. Cursor runs `cursor-agent models` (or
 * `agent models` when that binary is the configured command). Claude Code runs
 * `claude models` only when its help lists that command. Antigravity already
 * reads with `agy models`, so it is not asked twice. A CLI without a command
 * passes `refreshCli: null` and the read still happens.
 */
export const CLI_MODEL_REFRESH_TIMEOUT_MS = 60_000;

const HELP_COMMANDS_HEADING = /^commands:?$/i;
const HELP_SECTION_HEADING = /^[A-Za-z][A-Za-z ]+:$/;
const LAUNCH_SUBCOMMANDS_WITHOUT_MODELS = new Set([
  "acp",
  "debug",
  "run",
  "serve",
  "tui",
  "upgrade",
  "web",
]);

export async function refreshCliThenRead<T>(input: {
  refreshCli: (() => Promise<void>) | null;
  read: () => Promise<T>;
  signal?: AbortSignal;
  onRefreshError?: (error: unknown) => void;
}): Promise<T> {
  if (input.refreshCli) {
    try {
      input.signal?.throwIfAborted();
      await input.refreshCli();
    } catch (error) {
      // The deadline owns the signal. A timed-out CLI must not continue into a
      // read that the deadline is already aborting. Any other failure still reads.
      if (input.signal?.aborted) throw error;
      input.onRefreshError?.(error);
    }
  }
  input.signal?.throwIfAborted();
  return input.read();
}

/**
 * True when help text lists a `models` command. Claude Code prints a Commands
 * section whose rows are indented by two spaces and may alias names with `|`.
 * A mention of the word in an option or a wrapped description is not a command.
 */
export function cliHelpListsModelsCommand(help: string): boolean {
  let inCommands = false;
  for (const raw of help.split(/\r?\n/u)) {
    const trimmed = raw.trim();
    if (!inCommands) {
      if (HELP_COMMANDS_HEADING.test(trimmed)) inCommands = true;
      continue;
    }
    if (trimmed.length === 0) continue;
    if (HELP_SECTION_HEADING.test(trimmed)) break;
    const indent = raw.match(/^ */u)?.[0].length ?? 0;
    if (indent > 2) continue;
    const token = trimmed.split(/\s+/u)[0] ?? "";
    const names = token.split("|").map((name) => name.trim());
    if (names.includes("models")) return true;
  }
  return false;
}

/**
 * Args for `<binary> models`. A server or ACP subcommand is left alone: appending
 * `models` to `opencode serve` is not that CLI's model command.
 */
export function modelsSubcommandArgs(args: readonly string[]): string[] | null {
  const positional = args.filter((arg) => arg.length > 0 && !arg.startsWith("-"));
  if (positional.some((token) => LAUNCH_SUBCOMMANDS_WITHOUT_MODELS.has(token))) return null;
  if (positional.includes("models")) return [...args];
  return [...args, "models"];
}

/** `cursor-agent acp` is already reduced to the CLI binary before this runs. */
export function cursorModelsArgv(cliCommand: readonly string[]): {
  command: string;
  args: string[];
} {
  const [command, ...args] = cliCommand;
  return {
    command: command && command.length > 0 ? command : "cursor-agent",
    args: [...args, "models"],
  };
}
