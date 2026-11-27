/* eslint-disable paseo/no-sync-io -- fd cleanup runs before the child event loop starts */
import { closeSync, readdirSync, readlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PASEO_CLOSE_INHERITED_FDS_UNDER = "PASEO_CLOSE_INHERITED_FDS_UNDER";
const FD_DIRECTORIES = ["/proc/self/fd", "/dev/fd"];

function closeInheritedProfileFds(userDataPath: string | undefined): void {
  if (!userDataPath || process.platform === "win32") return;
  let fdDirectory: string | null = null;
  for (const candidate of FD_DIRECTORIES) {
    try {
      readdirSync(candidate);
      fdDirectory = candidate;
      break;
    } catch {
      // Try the next platform's descriptor directory.
    }
  }
  if (!fdDirectory) return;
  for (const entry of readdirSync(fdDirectory)) {
    const fd = Number(entry);
    if (!Number.isInteger(fd) || fd <= 2) continue;
    let target: string;
    try {
      target = readlinkSync(`${fdDirectory}/${entry}`);
    } catch {
      continue;
    }
    if (!target.startsWith(userDataPath)) continue;
    try {
      closeSync(fd);
    } catch {
      // The descriptor may have closed between listing and closing it.
    }
  }
}

export async function main(): Promise<void> {
  closeInheritedProfileFds(process.env[PASEO_CLOSE_INHERITED_FDS_UNDER]);
  const [argvMode, entryPath, ...args] = process.argv.slice(2);
  if (argvMode !== "bare" && argvMode !== "node-script") {
    throw new Error(`Unsupported node entrypoint argv mode: ${argvMode ?? "<missing>"}`);
  }
  if (!entryPath) {
    throw new Error("Missing node entrypoint path.");
  }

  process.argv =
    argvMode === "bare"
      ? [process.argv[0] ?? "node", ...args]
      : [process.argv[0] ?? "node", entryPath, ...args];
  await import(pathToFileURL(entryPath).href);
}

if (require.main === module) {
  void main().catch((error) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
