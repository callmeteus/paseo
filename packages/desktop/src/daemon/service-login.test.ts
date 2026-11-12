import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DAEMON_HUB_LAUNCH_ARG,
  applyDaemonHubLogin,
  darwinLaunchAgent,
  isDaemonHubServiceLaunch,
  linuxAutostartEntry,
  type DaemonHubLoginRequest,
} from "./service-login";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("daemon and hub login start", () => {
  it("recognizes the service launch argument and environment", () => {
    expect(
      isDaemonHubServiceLaunch({
        argv: ["/opt/Paseo/Paseo", DAEMON_HUB_LAUNCH_ARG],
        env: {},
      }),
    ).toBe(true);
    expect(
      isDaemonHubServiceLaunch({
        argv: ["/opt/Paseo/Paseo"],
        env: { PASEO_START_SERVICES: "1" },
      }),
    ).toBe(true);
    expect(isDaemonHubServiceLaunch({ argv: ["/opt/Paseo/Paseo"], env: {} })).toBe(false);
  });

  it("writes a Linux autostart entry only for a packaged app with the option on", async () => {
    const root = await makeRoot();
    const windows: boolean[] = [];
    await apply(root, {
      enabled: true,
      platform: "linux",
      packaged: true,
      setWindowsLogin: windows,
    });

    const entry = await readFile(
      path.join(root, "config", "autostart", "paseo-daemon-hub.desktop"),
      "utf8",
    );
    expect(entry).toBe(linuxAutostartEntry("/opt/Paseo/Paseo"));
    expect(entry).toContain("Exec=/usr/bin/env PASEO_START_SERVICES=1 /opt/Paseo/Paseo");
    expect(windows).toEqual([]);
  });

  it("quotes a Linux executable path that contains spaces", () => {
    expect(linuxAutostartEntry("/opt/Paseo App/Paseo")).toContain(
      'Exec=/usr/bin/env PASEO_START_SERVICES=1 "/opt/Paseo App/Paseo"',
    );
  });

  it("removes the Linux autostart entry when the option is off", async () => {
    const root = await makeRoot();
    const filePath = path.join(root, "config", "autostart", "paseo-daemon-hub.desktop");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "old\n");

    await apply(root, { enabled: false, platform: "linux", packaged: true });

    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves login entries alone when the app is not packaged", async () => {
    const root = await makeRoot();
    const filePath = path.join(root, "config", "autostart", "paseo-daemon-hub.desktop");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "keep\n");
    const windows: boolean[] = [];

    await apply(root, {
      enabled: true,
      platform: "linux",
      packaged: false,
      setWindowsLogin: windows,
    });

    expect(await readFile(filePath, "utf8")).toBe("keep\n");
    expect(windows).toEqual([]);
  });

  it("writes a macOS launch agent that escapes the executable path", async () => {
    const root = await makeRoot();
    await apply(root, {
      enabled: true,
      platform: "darwin",
      packaged: true,
      execPath: "/Applications/Paseo & Co.app/Contents/MacOS/Paseo",
    });

    const plist = await readFile(
      path.join(root, "home", "Library", "LaunchAgents", "sh.paseo.daemon-hub.plist"),
      "utf8",
    );
    expect(plist).toBe(darwinLaunchAgent("/Applications/Paseo & Co.app/Contents/MacOS/Paseo"));
    expect(plist).toContain(
      "<string>/Applications/Paseo &amp; Co.app/Contents/MacOS/Paseo</string>",
    );
    expect(plist).toContain(`<string>${DAEMON_HUB_LAUNCH_ARG}</string>`);
  });

  it("registers and clears the Windows login item with the packaged app", async () => {
    const root = await makeRoot();
    const windows: boolean[] = [];
    await apply(root, {
      enabled: true,
      platform: "win32",
      packaged: true,
      setWindowsLogin: windows,
    });
    await apply(root, {
      enabled: false,
      platform: "win32",
      packaged: true,
      setWindowsLogin: windows,
    });
    await apply(root, {
      enabled: true,
      platform: "win32",
      packaged: false,
      setWindowsLogin: windows,
    });

    expect(windows).toEqual([true, false]);
  });
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-service-login-"));
  roots.push(root);
  return root;
}

async function apply(
  root: string,
  patch: {
    enabled: boolean;
    platform: NodeJS.Platform;
    packaged: boolean;
    execPath?: string;
    setWindowsLogin?: boolean[];
  },
): Promise<void> {
  const request: DaemonHubLoginRequest = {
    enabled: patch.enabled,
    platform: patch.platform,
    packaged: patch.packaged,
    execPath: patch.execPath ?? "/opt/Paseo/Paseo",
    configHome: path.join(root, "config"),
    homeDirectory: path.join(root, "home"),
    writeFile: async (filePath, contents) => {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, contents);
    },
    removeFile: (filePath) => rm(filePath, { force: true }),
    setWindowsLogin: (enabled) => {
      patch.setWindowsLogin?.push(enabled);
    },
  };
  await applyDaemonHubLogin(request);
}
