import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PASEO_CLOSE_INHERITED_FDS_UNDER } from "./node-entrypoint-launcher.js";

const runnerPath = fileURLToPath(new URL("./node-entrypoint-runner.ts", import.meta.url));

const FIXTURE = `
import { existsSync, readdirSync, readlinkSync } from "node:fs";
const directory = process.platform === "linux" ? "/proc/self/fd" : "/dev/fd";
const prefix = process.env.PASEO_CLOSE_INHERITED_FDS_UNDER ?? "";
const remaining = readdirSync(directory)
  .map(Number)
  .filter((fd) => {
    if (!Number.isInteger(fd) || fd <= 2) return false;
    try {
      return readlinkSync(directory + "/" + fd).startsWith(prefix);
    } catch {
      return false;
    }
  });
process.stdout.write(
  JSON.stringify({ remaining, stdioOpen: [0, 1, 2].every((fd) => existsSync(directory + "/" + fd)) }),
);
`;

function spawnChild(args: string[], leakedFd: number, prefix: string) {
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe", leakedFd],
    env: { ...process.env, [PASEO_CLOSE_INHERITED_FDS_UNDER]: prefix },
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as { remaining: number[]; stdioOpen: boolean };
}

describe("desktop daemon child descriptors", () => {
  it("closes inherited Electron profile fds before loading the daemon entrypoint", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "paseo-fd-cleanup-"));
    try {
      const fixturePath = path.join(directory, "fd-fixture.mjs");
      const lockPath = path.join(directory, "LOCK");
      writeFileSync(fixturePath, FIXTURE);
      writeFileSync(lockPath, "");

      const directFd = openSync(lockPath, "r");
      let direct: ReturnType<typeof spawnChild>;
      try {
        direct = spawnChild(["--import", "tsx", fixturePath], directFd, directory);
      } finally {
        closeSync(directFd);
      }

      const runnerFd = openSync(lockPath, "r");
      let throughRunner: ReturnType<typeof spawnChild>;
      try {
        throughRunner = spawnChild(
          ["--import", "tsx", runnerPath, "node-script", fixturePath],
          runnerFd,
          directory,
        );
      } finally {
        closeSync(runnerFd);
      }

      expect(direct).toEqual({ remaining: [3], stdioOpen: true });
      expect(throughRunner).toEqual({ remaining: [], stdioOpen: true });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
