import { spawnSync } from "node:child_process";

/**
 * Whether a real Claude Code binary is installed and runnable on this host.
 * Unit tests that need the real CLI use this to skip cleanly on runners that
 * only provide Node; real-binary e2e suites keep their own, more detailed probe.
 */
export function isClaudeAvailable(): boolean {
  const probe = spawnSync("claude", ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
    shell: process.platform === "win32",
  });
  return probe.status === 0;
}
