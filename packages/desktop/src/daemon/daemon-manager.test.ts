import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DESKTOP_SETTINGS } from "../settings/desktop-settings";
import { ExternalCliCommandError } from "./cli/external";
import {
  createDaemonCommandHandlers,
  ensureDesktopDaemonStarted,
  keepsTerminalsOnStop,
  stopCapturedDaemon,
  type DesktopDaemonStopReason,
} from "./daemon-manager";

const mocks = vi.hoisted(() => ({
  paseoHome: "",
  settings: {
    releaseChannel: "stable",
    daemon: {
      manageBuiltInDaemon: true,
      keepRunningAfterQuit: true,
    },
  },
  runExternalCliJsonCommand: vi.fn(),
  runExternalCliTextCommand: vi.fn(),
  startDaemonInstance: vi.fn(),
  startInstalledLocalHub: vi.fn(async () => ({ outcome: "not_installed" as const, origin: null })),
  createNodeEntrypointInvocation: vi.fn(() => ({
    command: "node",
    args: [],
    env: {},
  })),
  spawnProcess: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  appLogPath: "",
  getElectronLogFile: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => mocks.paseoHome),
    getVersion: vi.fn(() => "1.2.3"),
    isPackaged: true,
  },
  ipcMain: { handle: vi.fn() },
  powerMonitor: { getSystemIdleTime: vi.fn(() => 0) },
}));

vi.mock("electron-log/main", () => ({
  default: {
    info: mocks.logInfo,
    error: mocks.logError,
    transports: {
      file: {
        getFile: mocks.getElectronLogFile,
      },
    },
  },
}));

vi.mock("@getpaseo/server/hub-local", () => ({
  startInstalledLocalHub: mocks.startInstalledLocalHub,
}));

vi.mock("@getpaseo/server/daemon-control", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolvePaseoHome: () => mocks.paseoHome,
  spawnProcess: mocks.spawnProcess,
  startDaemonInstance: mocks.startDaemonInstance,
}));

vi.mock("../settings/desktop-settings-electron.js", () => ({
  getDesktopSettingsStore: () => ({
    get: async () => mocks.settings,
    patch: vi.fn(),
    migrateLegacyRendererSettings: vi.fn(),
  }),
}));

vi.mock("./runtime-paths.js", () => ({
  createNodeEntrypointInvocation: mocks.createNodeEntrypointInvocation,
  resolveDaemonRunnerEntrypoint: vi.fn(() => ({
    entryPath: path.join(mocks.paseoHome, "daemon.js"),
    execArgv: [],
  })),
}));

vi.mock("./cli/external.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runExternalCliJsonCommand: mocks.runExternalCliJsonCommand,
  runExternalCliTextCommand: mocks.runExternalCliTextCommand,
}));

describe("daemon-manager commands", () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "paseo daemon manager "));
    mocks.paseoHome = path.join(fixtureRoot, "home");
    mocks.appLogPath = path.join(fixtureRoot, "main.log");
    mocks.settings = DEFAULT_DESKTOP_SETTINGS;
    mocks.runExternalCliJsonCommand.mockReset();
    mocks.runExternalCliTextCommand.mockReset();
    mocks.startDaemonInstance.mockReset();
    mocks.startInstalledLocalHub.mockReset();
    mocks.startInstalledLocalHub.mockResolvedValue({ outcome: "not_installed", origin: null });
    mocks.createNodeEntrypointInvocation.mockReset();
    mocks.createNodeEntrypointInvocation.mockReturnValue({ command: "node", args: [], env: {} });
    mocks.spawnProcess.mockReset();
    mocks.logInfo.mockReset();
    mocks.logError.mockReset();
    mocks.getElectronLogFile.mockReset();
    mocks.getElectronLogFile.mockReturnValue({ path: mocks.appLogPath });
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("returns the Electron main-process log tail from electron-log", () => {
    writeFileSync(
      mocks.appLogPath,
      Array.from({ length: 105 }, (_value, index) => `main log line ${index + 1}`).join("\n"),
    );
    const handlers = createDaemonCommandHandlers();

    expect(handlers.desktop_app_logs()).toEqual({
      logPath: mocks.appLogPath,
      contents: Array.from({ length: 100 }, (_value, index) => `main log line ${index + 6}`).join(
        "\n",
      ),
    });
  });

  it("exposes updater diagnostics through the desktop command boundary", () => {
    const diagnostics = createDaemonCommandHandlers().desktop_update_diagnostics();

    expect(diagnostics).toMatchObject({
      platform: process.platform,
      currentVersion: "1.2.3",
    });
  });

  it("reports a stopped daemon without launching the CLI when no local daemon runs", async () => {
    mkdirSync(mocks.paseoHome);
    writeFileSync(path.join(mocks.paseoHome, "server-id"), "srv_existing\n");
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      home: mocks.paseoHome,
      pid: null,
      startedAt: null,
      listen: null,
      hostname: null,
      localDaemon: "stopped",
      desktopManaged: false,
      connectedDaemon: "not_probed",
    });

    const status = await createDaemonCommandHandlers().desktop_daemon_status();

    expect(status).toMatchObject({ serverId: "", status: "stopped", pid: null });
    expect(mocks.runExternalCliJsonCommand).not.toHaveBeenCalled();
  });

  it("reports an errored daemon when the local daemon state cannot be read", async () => {
    mkdirSync(mocks.paseoHome);
    writeFileSync(path.join(mocks.paseoHome, "paseo.pid"), "garbage");

    const status = await createDaemonCommandHandlers().desktop_daemon_status();

    expect(status).toMatchObject({ serverId: "", status: "errored", pid: null });
    expect(status.error).toBeTruthy();
  });

  it("returns a local credential only for its live managed daemon listen", async () => {
    mkdirSync(mocks.paseoHome);
    const token = "a".repeat(43);
    writeFileSync(path.join(mocks.paseoHome, "local-credential"), `${token}\n`, { mode: 0o600 });
    const lock = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      hostname: hostname(),
      uid: process.getuid?.() ?? 0,
      listen: "127.0.0.1:6799",
      desktopManaged: true,
    };
    const lockPath = path.join(mocks.paseoHome, "paseo.pid");
    writeFileSync(lockPath, JSON.stringify(lock));
    const handler = createDaemonCommandHandlers().desktop_local_credential;
    expect(await handler({ listen: "localhost:6799" })).toBe(token);
    expect(await handler({ listen: "remote:6799" })).toBeNull();
    writeFileSync(lockPath, JSON.stringify({ ...lock, desktopManaged: false }));
    expect(await handler({ listen: "localhost:6799" })).toBeNull();
  });

  it("waits for a daemon that is already starting instead of failing with an empty server id", async () => {
    mkdirSync(mocks.paseoHome);
    writeDaemonLock(mocks.paseoHome, { listen: null, serverId: null });
    mocks.runExternalCliJsonCommand.mockImplementation(async () =>
      daemonStatusFromLock(mocks.paseoHome),
    );

    const pending = createDaemonCommandHandlers().start_desktop_daemon();
    await vi.waitFor(() => {
      expect(mocks.runExternalCliJsonCommand).toHaveBeenCalledTimes(1);
    });
    writeDaemonLock(mocks.paseoHome, { listen: "127.0.0.1:6767", serverId: "srv_ready" });

    await expect(pending).resolves.toMatchObject({
      serverId: "srv_ready",
      status: "running",
      listen: "127.0.0.1:6767",
    });
    expect(mocks.startDaemonInstance).not.toHaveBeenCalled();
  });

  it("shares one start while the daemon is still publishing its server id", async () => {
    mkdirSync(mocks.paseoHome);
    let releaseStart: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    mocks.runExternalCliJsonCommand.mockImplementation(async () =>
      daemonStatusFromLock(mocks.paseoHome),
    );
    mocks.startDaemonInstance.mockImplementation(async (input: { home: string }) => {
      writeDaemonLock(input.home, { listen: null, serverId: null });
      await gate;
      const instance = writeDaemonLock(input.home, {
        listen: "127.0.0.1:6767",
        serverId: "srv_ready",
      });
      return { instance, spawned: true };
    });

    const start = createDaemonCommandHandlers().start_desktop_daemon;
    const first = start();
    const second = start();
    releaseStart();

    await expect(first).resolves.toMatchObject({ serverId: "srv_ready", status: "running" });
    await expect(second).resolves.toMatchObject({ serverId: "srv_ready", status: "running" });
    expect(mocks.startDaemonInstance).toHaveBeenCalledTimes(1);
  });

  it("starts an installed hub when daemon management is on and the daemon is already running", async () => {
    mkdirSync(mocks.paseoHome);
    writeDaemonLock(mocks.paseoHome, { listen: "127.0.0.1:6767", serverId: "srv_ready" });
    mocks.runExternalCliJsonCommand.mockImplementation(async () =>
      daemonStatusFromLock(mocks.paseoHome),
    );

    await ensureDesktopDaemonStarted();

    expect(mocks.startInstalledLocalHub).toHaveBeenCalledWith(mocks.paseoHome);
    expect(mocks.startDaemonInstance).not.toHaveBeenCalled();
  });

  it("does not start the hub when daemon management is off", async () => {
    mocks.settings = {
      ...DEFAULT_DESKTOP_SETTINGS,
      daemon: { ...DEFAULT_DESKTOP_SETTINGS.daemon, manageBuiltInDaemon: false },
    };

    await ensureDesktopDaemonStarted();

    expect(mocks.startInstalledLocalHub).not.toHaveBeenCalled();
    expect(mocks.startDaemonInstance).not.toHaveBeenCalled();
  });
});

function readBootId(): string | undefined {
  try {
    const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    return bootId.length > 0 ? bootId : undefined;
  } catch {
    return undefined;
  }
}

function writeDaemonLock(
  home: string,
  patch: { listen: string | null; serverId: string | null },
): {
  pid: number;
  startedAt: string;
  hostname: string;
  uid: number;
  listen: string | null;
  serverId: string | null;
  desktopManaged: boolean;
  bootId?: string;
} {
  const lockPath = path.join(home, "paseo.pid");
  const bootId = readBootId();
  let startedAt = new Date().toISOString();
  try {
    const parsed: unknown = JSON.parse(readFileSync(lockPath, "utf8"));
    if (isRecord(parsed) && typeof parsed.startedAt === "string") {
      startedAt = parsed.startedAt;
    }
  } catch {
    startedAt = new Date().toISOString();
  }
  const lock = {
    pid: process.pid,
    startedAt,
    hostname: hostname(),
    uid: process.getuid?.() ?? 0,
    desktopManaged: true,
    ...(bootId ? { bootId } : {}),
    ...patch,
  };
  writeFileSync(lockPath, JSON.stringify(lock));
  return lock;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readLockString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function daemonStatusFromLock(home: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path.join(home, "paseo.pid"), "utf8"));
  const raw = isRecord(parsed) ? parsed : {};
  const listen = readLockString(raw, "listen");
  const pid = raw.pid;
  return {
    home,
    pid: typeof pid === "number" ? pid : null,
    startedAt: readLockString(raw, "startedAt"),
    listen,
    serverId: readLockString(raw, "serverId"),
    hostname: readLockString(raw, "hostname"),
    localDaemon: listen ? "running" : "not_ready",
    desktopManaged: raw.desktopManaged === true,
    connectedDaemon: listen ? "reachable" : "not_probed",
    daemonVersion: "1.2.3",
  };
}

describe("desktop stops and terminals", () => {
  const reasons: DesktopDaemonStopReason[] = [
    "manual_ipc",
    "settings",
    "host_remove",
    "quit",
    "app_update",
    "version_mismatch",
    "restart",
  ];

  it("keeps terminals only for an app update or version-mismatch restart, never on Windows", () => {
    for (const platform of ["darwin", "linux"] as const) {
      expect(reasons.filter((reason) => keepsTerminalsOnStop(reason, platform))).toEqual([
        "app_update",
        "version_mismatch",
      ]);
    }
    expect(reasons.filter((reason) => keepsTerminalsOnStop(reason, "win32"))).toEqual([]);
  });

  function stopHarness(runCliJson: (args: string[]) => Promise<unknown>) {
    const stops: Array<{ keepTerminals: boolean | undefined }> = [];
    const logged: string[] = [];
    const instance = {
      pid: 4242,
      startedAt: "2026-10-21T00:00:00.000Z",
      hostname: "host",
      uid: 501,
      listen: "127.0.0.1:6799",
    };
    const stopInstance = (async (
      _home: string,
      options: {
        keepTerminals?: boolean;
        requestShutdown?: (ready: { listen: string }) => Promise<void>;
      },
    ) => {
      stops.push({ keepTerminals: options.keepTerminals });
      await options.requestShutdown?.({ listen: instance.listen });
      return { action: "stopped", pid: instance.pid, forced: false, usedLifecycleRpc: true };
    }) as unknown as NonNullable<Parameters<typeof stopCapturedDaemon>[0]["stopInstance"]>;
    return {
      stops,
      logged,
      input: {
        home: "/tmp/paseo-home",
        instance,
        stopInstance,
        runCliJson,
        log: (message: string) => logged.push(message),
      } as Omit<Parameters<typeof stopCapturedDaemon>[0], "reason" | "keepTerminals">,
    };
  }

  it("asks the daemon to keep its terminals on an app update", async () => {
    const calls: string[][] = [];
    const harness = stopHarness(async (args) => {
      calls.push(args);
      return { action: "shutdown_requested" };
    });

    await stopCapturedDaemon({ ...harness.input, reason: "app_update", keepTerminals: true });

    expect(harness.stops).toEqual([{ keepTerminals: true }]);
    expect(calls).toEqual([
      ["daemon", "stop", "--host", "127.0.0.1:6799", "--keep-terminals", "--json"],
    ]);
  });

  it("stops a daemon without the capability with its terminals closed, and says so", async () => {
    const calls: string[][] = [];
    const harness = stopHarness(async (args) => {
      calls.push(args);
      if (args.includes("--keep-terminals")) {
        throw new ExternalCliCommandError("refused", {
          code: "TERMINALS_KEEP_UNSUPPORTED",
          version: "0.11.0",
        });
      }
      return { action: "shutdown_requested" };
    });

    await stopCapturedDaemon({ ...harness.input, reason: "app_update", keepTerminals: true });

    expect(harness.stops).toEqual([{ keepTerminals: true }, { keepTerminals: false }]);
    expect(calls[1]).toEqual(["daemon", "stop", "--host", "127.0.0.1:6799", "--json"]);
    expect(harness.logged).toContain(
      "daemon v0.11.0 cannot keep terminals; stopping it and closing them",
    );
  });

  it("does not retry a keep stop that failed for another reason", async () => {
    const harness = stopHarness(async () => {
      throw new ExternalCliCommandError("unreachable", { code: "DAEMON_UNREACHABLE" });
    });

    await expect(
      stopCapturedDaemon({ ...harness.input, reason: "app_update", keepTerminals: true }),
    ).rejects.toThrow("unreachable");
    expect(harness.stops).toEqual([{ keepTerminals: true }]);
  });
});
