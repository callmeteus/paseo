/* eslint-disable paseo/no-sync-io -- fd cleanup runs before the child event loop starts */
import { closeSync, readdirSync, readlinkSync } from "node:fs";

const FD_DIRECTORIES = ["/proc/self/fd", "/dev/fd"];

/**
 * Chromium opens profile files (notably the localStorage leveldb LOCK) without close-on-exec.
 * Children launched by the desktop app inherit those descriptors and keep them after the app
 * exits, so the next launch cannot lock the database and recreates it empty.
 *
 * Call this as early as possible in a launched Node process. It closes only descriptors that
 * point under the Electron userData directory; stdio, sockets, and Node's own descriptors stay.
 */
export function closeInheritedProfileFds(userDataPath: string | undefined): number {
  if (!userDataPath || process.platform === "win32") return 0;

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
  if (!fdDirectory) return 0;

  let closed = 0;
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
      closed += 1;
    } catch {
      // A descriptor may have closed between listing and closing it.
    }
  }
  return closed;
}
