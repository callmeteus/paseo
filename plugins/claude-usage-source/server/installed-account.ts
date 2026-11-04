import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import {
  hashAccountKey,
  unavailable,
  type UsageAccount,
  type UsageReport,
  type UsageScope,
} from "@getpaseo/plugin/server/usage";
import type { UsageInput } from "../shared/input.js";

/** Route path that means the Claude CLI is installed and nobody is signed in. */
export const CLAUDE_NOT_SIGNED_IN_PATH = "claude:not-signed-in";

/**
 * Adds a visible Claude account when the CLI is installed but no login was found.
 *
 * @param scope - Usage scope. Only the host-wide list gets the signed-out account
 * @param accounts - Logins already discovered from credential stores
 * @param installed - Resolves whether the `claude` command is on PATH. Tests pass a stub
 * @returns The discovered logins, or one signed-out account when the CLI exists and none do
 */
export async function withInstalledClaudeAccount(
  scope: UsageScope,
  accounts: readonly UsageAccount[],
  installed: () => Promise<boolean> = claudeInstalled,
): Promise<UsageAccount[]> {
  if (accounts.length > 0 || scope.kind !== "global") {
    return [...accounts];
  }

  // An enabled Claude with no stored token still belongs on the usage window.
  if (!(await installed())) {
    return [];
  }

  return [signedOutClaudeAccount()];
}

/**
 * The report shown until `claude auth login` stores a token.
 *
 * @param input - Usage route the daemon asked to fetch
 * @returns The signed-out report, or null when this route is a real credential store
 */
export function signedOutClaudeReport(input: UsageInput): UsageReport | null {
  if (input.route.store !== "claude" || input.route.path !== CLAUDE_NOT_SIGNED_IN_PATH) {
    return null;
  }

  return unavailable({
    kind: "no_quota",
    detail: "Claude is not signed in. Run claude auth login.",
  });
}

/**
 * Account locator for an installed Claude CLI that has no login yet.
 *
 * @returns Account whose fetch explains that Claude is signed out
 */
function signedOutClaudeAccount(): UsageAccount {
  return {
    key: hashAccountKey("claude:not-signed-in"),
    harness: "Claude",
    input: {
      route: {
        store: "claude",
        path: CLAUDE_NOT_SIGNED_IN_PATH,
      },
    },
  };
}

/**
 * Whether the `claude` executable is on PATH.
 *
 * @returns True when the CLI can be launched
 */
function claudeInstalled(): Promise<boolean> {
  return commandOnPath("claude");
}

/**
 * Reports whether a command name resolves to an executable file on PATH.
 *
 * @param command - Executable name, without arguments
 * @param env - Environment whose PATH is searched. Defaults to the process environment
 * @returns True when an executable file is found
 */
export async function commandOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (!command || command.includes("/") || command.includes("\\")) {
    return executableFile(command);
  }

  const directories = (env.PATH ?? "").split(delimiter);
  const extensions = env.PATHEXT ? env.PATHEXT.split(";") : [""];

  for (const directory of directories) {
    if (!directory) {
      continue;
    }

    for (const extension of extensions) {
      if (await executableFile(join(directory, `${command}${extension}`))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * True when the path is an executable file.
 *
 * @param filePath - Candidate binary path
 * @returns True for an executable file, false for directories and missing paths
 */
async function executableFile(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);

    if (!info.isFile()) {
      return false;
    }

    if (process.platform === "win32") {
      return true;
    }

    await access(filePath, constants.X_OK);
    return (info.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}
