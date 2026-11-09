import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `npm run dev` and `npm run dev:app` are the entry points people type on every
 * platform. The POSIX launchers are shell scripts; Windows needs its own. Keeping
 * the choice here means both paths expose the dev stack on the tailnet instead of
 * one platform silently starting on localhost (or failing to start at all).
 */
const TARGETS = new Set(["daemon", "app"]);
const target = process.argv[2];
if (!target || !TARGETS.has(target)) {
  console.error("Usage: node scripts/dev-launch.mjs <daemon|app>");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

const command = isWindows
  ? {
      file: "powershell",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(root, "scripts", "dev-launcher.ps1"),
        "-Target",
        target,
      ],
    }
  : {
      file: join(root, "scripts", target === "app" ? "dev-app.sh" : "dev-daemon.sh"),
      args: [],
    };

const result = spawnSync(command.file, command.args, {
  stdio: "inherit",
  cwd: root,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
