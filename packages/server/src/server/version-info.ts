/* eslint-disable paseo/no-sync-io -- merge: pre-existing synchronous IO */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface PaseoCommitInfo {
  commit: string | null;
  mainCommit: string | null;
}

const GIT_TIMEOUT_MS = 5_000;
const SHORT_SHA_LENGTH = 7;

function gitOutput(cwd: string, args: readonly string[]): string | null {
  try {
    const output = execFileSync("git", [...args], {
      cwd,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.trim() || null;
  } catch {
    return null;
  }
}

function resolveSourceRoot(): string | null {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (existsSync(path.join(directory, ".git"))) {
      return directory;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return null;
    }
    directory = parent;
  }
}

let cached: PaseoCommitInfo | null = null;

/**
 * Commit identity for the running daemon. Both values are best effort: packaged
 * installs have no checkout, and the remote read needs network access.
 */
export function getPaseoCommitInfo(): PaseoCommitInfo {
  if (cached) {
    return cached;
  }
  const root = resolveSourceRoot();
  if (!root) {
    cached = { commit: null, mainCommit: null };
    return cached;
  }
  const commit = gitOutput(root, ["rev-parse", "--short", "HEAD"]);
  const remoteHead = gitOutput(root, ["ls-remote", "origin", "refs/heads/main"]);
  cached = {
    commit,
    mainCommit: remoteHead?.split(/\s+/)[0]?.slice(0, SHORT_SHA_LENGTH) ?? null,
  };
  return cached;
}
