import { pathToFileURL } from "node:url";
import { closeInheritedProfileFds } from "@getpaseo/server/close-inherited-fds";
import { PASEO_CLOSE_INHERITED_FDS_UNDER } from "./node-entrypoint-launcher.js";

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
