import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_BYTES = 2_000_000;

export interface PaseoUpdateProgress {
  phase: string;
}

export interface PaseoUpdateResult {
  success: boolean;
  message: string;
  paseoCommit: string | null;
  hubCommit: string | null;
}

type Client = Pick<DaemonClient, "runCommand">;

async function exec(
  client: Client,
  cwd: string,
  command: string,
  args: readonly string[],
): Promise<string> {
  const response = await client.runCommand({
    cwd,
    command,
    args: [...args],
    timeoutMs: UPDATE_TIMEOUT_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
  });
  if (response.status !== "exited" || response.exitCode !== 0) {
    const detail = response.error?.trim() || response.stderr.trim() || response.stdout.trim();
    throw new Error(`${command} ${args.join(" ")} failed: ${detail || response.status}`);
  }
  return response.stdout.trim();
}

/** Fast-forward a checkout to origin/main. Refuses to destroy local work. */
async function fastForwardToMain(
  client: Client,
  cwd: string,
  label: string,
  buildScript: string,
  onProgress: (progress: PaseoUpdateProgress) => void,
): Promise<string> {
  onProgress({ phase: `${label}: fetching main` });
  await exec(client, cwd, "git", ["fetch", "origin", "main"]);
  onProgress({ phase: `${label}: fast-forwarding to origin/main` });
  await exec(client, cwd, "git", ["pull", "--ff-only", "origin", "main"]);
  onProgress({ phase: `${label}: installing dependencies` });
  await exec(client, cwd, "npm", ["install"]);
  onProgress({ phase: `${label}: building` });
  await exec(client, cwd, "npm", ["run", buildScript]);
  return exec(client, cwd, "git", ["rev-parse", "--short", "HEAD"]);
}

function localHubCheckoutExpression(): string {
  const expression = [
    "const path=require('path'),os=require('os'),fs=require('fs');",
    "const dir=path.join(os.homedir(),'.paseo','hub-app');",
    "process.stdout.write(fs.existsSync(path.join(dir,'.git'))?dir:'');",
  ].join("");
  return expression;
}

/**
 * Updates the Paseo checkout that contains `cwd`, then the local Hub checkout when
 * one is installed. Runs through the daemon's process.exec RPC, so it works on a
 * remote host as long as that host allows git/npm/node commands.
 */
export async function runPaseoUpdate(
  client: Client,
  cwd: string,
  onProgress: (progress: PaseoUpdateProgress) => void,
): Promise<PaseoUpdateResult> {
  try {
    onProgress({ phase: "Locating the Paseo checkout" });
    const root = await exec(client, cwd, "git", ["rev-parse", "--show-toplevel"]);
    if (!root) {
      return {
        success: false,
        message: "Current workspace is not a git checkout",
        paseoCommit: null,
        hubCommit: null,
      };
    }
    const packageName = await exec(client, root, "node", ["-p", "require('./package.json').name"]);
    if (packageName !== "paseo") {
      return {
        success: false,
        message: `Current checkout is "${packageName}", not Paseo`,
        paseoCommit: null,
        hubCommit: null,
      };
    }

    const paseoCommit = await fastForwardToMain(client, root, "Paseo", "build", onProgress);

    onProgress({ phase: "Checking for a local Hub install" });
    const hubPath = await exec(client, root, "node", ["-e", localHubCheckoutExpression()]);
    const hubCommit = hubPath
      ? await fastForwardToMain(client, hubPath, "Hub", "build", onProgress)
      : null;

    const hubSummary = hubCommit ? `, Hub @ ${hubCommit}` : ", Hub not installed";
    return {
      success: true,
      message: `Updated Paseo @ ${paseoCommit}${hubSummary}`,
      paseoCommit,
      hubCommit,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      paseoCommit: null,
      hubCommit: null,
    };
  }
}
