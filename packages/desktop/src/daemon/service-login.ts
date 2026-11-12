import path from "node:path";

/** Argument that starts the daemon and an already-installed Hub, then exits. */
export const DAEMON_HUB_LAUNCH_ARG = "--start-services";
/** Environment mark for the same login start. Chromium keeps this when it drops switches. */
export const DAEMON_HUB_LAUNCH_ENV = "PASEO_START_SERVICES";

const LAUNCH_AGENT_LABEL = "sh.paseo.daemon-hub";

export interface DaemonHubLoginRequest {
  enabled: boolean;
  platform: NodeJS.Platform;
  packaged: boolean;
  execPath: string;
  configHome: string;
  homeDirectory: string;
  writeFile(filePath: string, contents: string): Promise<void>;
  removeFile(filePath: string): Promise<void>;
  setWindowsLogin(enabled: boolean): void;
}

/**
 * @param input - Process arguments and environment
 * @returns Whether this process should start services and exit
 */
export function isDaemonHubServiceLaunch(input: {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
}): boolean {
  return input.argv.includes(DAEMON_HUB_LAUNCH_ARG) || input.env[DAEMON_HUB_LAUNCH_ENV] === "1";
}

/**
 * Writes or removes the login entry for the daemon and Hub.
 *
 * An unpackaged dev build does not change the entry. The packaged app owns it,
 * and only while the daemon option is on.
 *
 * @param request - Platform paths and the persisted option
 * @returns Nothing
 */
export async function applyDaemonHubLogin(request: DaemonHubLoginRequest): Promise<void> {
  if (!request.packaged) return;
  if (request.platform === "linux") {
    const filePath = path.join(request.configHome, "autostart", "paseo-daemon-hub.desktop");
    if (!request.enabled) {
      await request.removeFile(filePath);
      return;
    }
    await request.writeFile(filePath, linuxAutostartEntry(request.execPath));
    return;
  }
  if (request.platform === "darwin") {
    const filePath = path.join(
      request.homeDirectory,
      "Library",
      "LaunchAgents",
      `${LAUNCH_AGENT_LABEL}.plist`,
    );
    if (!request.enabled) {
      await request.removeFile(filePath);
      return;
    }
    await request.writeFile(filePath, darwinLaunchAgent(request.execPath));
    return;
  }
  if (request.platform === "win32") {
    request.setWindowsLogin(request.enabled);
  }
}

/**
 * @param execPath - Packaged Paseo executable
 * @returns XDG autostart desktop entry
 */
export function linuxAutostartEntry(execPath: string): string {
  return `[Desktop Entry]
Type=Application
Version=1.0
Name=Paseo
Comment=Start the Paseo daemon and Hub
Exec=/usr/bin/env ${DAEMON_HUB_LAUNCH_ENV}=1 ${desktopExecToken(execPath)}
Terminal=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
`;
}

/**
 * @param execPath - Packaged Paseo executable
 * @returns LaunchAgent plist
 */
export function darwinLaunchAgent(execPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlText(execPath)}</string>
    <string>${DAEMON_HUB_LAUNCH_ARG}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>${DAEMON_HUB_LAUNCH_ENV}</key>
    <string>1</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`;
}

function desktopExecToken(execPath: string): string {
  if (!/[\s"$`\\]/.test(execPath)) return execPath;
  return `"${execPath.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function xmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
