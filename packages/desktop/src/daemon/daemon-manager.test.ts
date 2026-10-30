import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DESKTOP_SETTINGS } from "../settings/desktop-settings";
import { createDaemonCommandHandlers } from "./daemon-manager";

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

vi.mock("./cli/external.js", () => ({
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
