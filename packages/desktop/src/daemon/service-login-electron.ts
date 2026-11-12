import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { app } from "electron";
import log from "electron-log/main";
import { applyDaemonHubLogin, DAEMON_HUB_LAUNCH_ARG } from "./service-login.js";

/**
 * Keeps the OS login entry aligned with the daemon option.
 *
 * @param enabled - Whether Paseo should start the daemon and Hub
 * @returns Nothing
 */
export async function syncDaemonHubLogin(enabled: boolean): Promise<void> {
  try {
    await applyDaemonHubLogin({
      enabled,
      platform: process.platform,
      packaged: app.isPackaged,
      execPath: process.execPath,
      configHome: process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"),
      homeDirectory: homedir(),
      writeFile: async (filePath, contents) => {
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, contents, "utf8");
      },
      removeFile: (filePath) => rm(filePath, { force: true }),
      setWindowsLogin: (openAtLogin) => {
        app.setLoginItemSettings({
          openAtLogin,
          args: openAtLogin ? [DAEMON_HUB_LAUNCH_ARG] : [],
        });
      },
    });
  } catch (error) {
    log.error("[daemon-hub] failed to update login start", error);
  }
}
