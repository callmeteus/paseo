import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, closeSync, openSync, readFileSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import type { HubLocalInstallPhase } from "@getpaseo/protocol/messages";
import { findExecutable } from "../../executable-resolution/executable-resolution.js";
import { ensurePrivateFile, PRIVATE_FILE_MODE } from "../private-files.js";

/** The automations tab installs Hub from this public fork. */
export const HUB_GITHUB_REPOSITORY = "callmeteus/paseo-hub";
export const HUB_GITHUB_CLONE_URL = "https://github.com/callmeteus/paseo-hub.git";
/**
 * Local Hub listen port.
 *
 * 3000 is the LuckyMaker site and the pixrouter Caddy, so this Hub stays off that port.
 */
export const LOCAL_HUB_PORT = "25000";
export const LOCAL_HUB_ORIGIN = `http://127.0.0.1:${LOCAL_HUB_PORT}`;
/** How long a start may sit on /health before the installer gives up. */
export const LOCAL_HUB_READY_TIMEOUT_MS = 90_000;
const HEALTH_POLL_INTERVAL_MS = 1_000;

export interface HubLocalInstallState {
  installed: boolean;
  running: boolean;
  origin: string | null;
}

export interface HubLocalInstallProgress {
  phase: HubLocalInstallPhase;
  percent: number;
}

export interface HubInstallCommand {
  command: string;
  args: readonly string[];
  cwd?: string;
}

export interface InstalledHubStartResult {
  outcome: "not_installed" | "already_running" | "started";
  origin: string | null;
}

export interface HubLocalInstaller {
  status(): Promise<HubLocalInstallState>;
  install(onProgress: (progress: HubLocalInstallProgress) => void): Promise<HubLocalInstallState>;
  startInstalled(): Promise<InstalledHubStartResult>;
}

export interface HubLocalInstallerDependencies {
  paseoHome: string;
  run(command: HubInstallCommand, onLine: (line: string) => void): Promise<void>;
  probeHealth(origin: string): Promise<boolean>;
  start(checkout: string, dataDirectory: string, nodePath: string): Promise<void>;
  fileExists(filePath: string): Promise<boolean>;
  resolveTools?: () => Promise<{ npm: string; node: string }>;
}

const PHASE_FLOOR: Record<HubLocalInstallPhase, number> = {
  preparing: 5,
  downloading: 15,
  installing: 40,
  starting: 88,
  ready: 100,
};

const PHASE_CEILING: Record<HubLocalInstallPhase, number> = {
  preparing: 12,
  downloading: 39,
  installing: 87,
  starting: 99,
  ready: 100,
};

/**
 * Percent for a phase, nudged forward as command output arrives.
 *
 * @param phase - Current install step
 * @param lines - Output lines seen during that step
 * @returns Integer from 0 to 100
 */
export function hubInstallPercent(phase: HubLocalInstallPhase, lines: number): number {
  const floor = PHASE_FLOOR[phase];
  const ceiling = PHASE_CEILING[phase];
  const extra = Math.min(ceiling - floor, Math.floor(Math.max(0, lines) / 4));
  return floor + extra;
}

/**
 * Bar position while /health is still failing.
 *
 * @param waitedMs - Time since the process was spawned
 * @returns Integer from the starting floor through the starting ceiling
 */
export function hubStartupWaitPercent(waitedMs: number): number {
  const floor = PHASE_FLOOR.starting;
  const ceiling = PHASE_CEILING.starting;
  const ratio = Math.min(1, Math.max(0, waitedMs) / LOCAL_HUB_READY_TIMEOUT_MS);
  return floor + Math.floor(ratio * (ceiling - floor));
}

/**
 * Checkout used by the in-app installer. Data lives beside it, under the daemon home.
 *
 * @param paseoHome - Daemon home directory
 * @returns Absolute checkout path
 */
export function localHubCheckoutDirectory(paseoHome: string): string {
  return path.join(paseoHome, "hub-app");
}

/**
 * @param paseoHome - Daemon home directory
 * @returns Absolute Hub data directory
 */
export function localHubDataDirectory(paseoHome: string): string {
  return path.join(paseoHome, "hub-data");
}

const HUB_PROCESS_ENV_KEYS = [
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "XDG_RUNTIME_DIR",
  "XDG_DATA_HOME",
  "XDG_CONFIG_HOME",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "ALL_PROXY",
  "all_proxy",
] as const;

const HUB_LOG_TAIL_LIMIT = 1_500;

let activeInstall: Promise<HubLocalInstallState> | null = null;
let hubProcess: ChildProcess | null = null;
let hubGeneration = 0;
let hubProcessExit: HubProcessExit | null = null;
let hubLogPath: string | null = null;

interface HubProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Installer bound to the daemon home. Concurrent installs share one in-flight job.
 *
 * @param dependencies - Process and filesystem hooks
 * @returns Status and install operations
 */
export function createHubLocalInstaller(
  dependencies: HubLocalInstallerDependencies,
): HubLocalInstaller {
  return {
    status: () => readInstallState(dependencies),
    install: (onProgress) => {
      if (activeInstall !== null) return activeInstall;
      activeInstall = runInstall(dependencies, onProgress).finally(() => {
        activeInstall = null;
      });
      return activeInstall;
    },
    startInstalled: () => startInstalledHub(dependencies),
  };
}

/**
 * Starts a Hub that was already installed. A missing build is left untouched.
 *
 * @param paseoHome - Daemon home directory
 * @returns Whether a build was present, and the origin when it is running
 */
export function startInstalledLocalHub(paseoHome: string): Promise<InstalledHubStartResult> {
  return daemonHubLocalInstaller(paseoHome).startInstalled();
}

/**
 * The installer the daemon session uses: git, npm, and a detached Hub process.
 *
 * @param paseoHome - Daemon home directory
 * @returns Live installer
 */
export function daemonHubLocalInstaller(paseoHome: string): HubLocalInstaller {
  return createHubLocalInstaller({
    paseoHome,
    run: runHubInstallCommand,
    probeHealth,
    start: (checkout, dataDirectory, nodePath) =>
      startLocalHubProcess(checkout, dataDirectory, nodePath),
    fileExists,
  });
}

async function startInstalledHub(
  dependencies: HubLocalInstallerDependencies,
): Promise<InstalledHubStartResult> {
  if (activeInstall !== null) {
    try {
      await activeInstall;
    } catch {
      // The checkout is whatever that install left on disk.
    }
  }
  const checkout = localHubCheckoutDirectory(dependencies.paseoHome);
  const built = await dependencies.fileExists(path.join(checkout, "dist", "index.js"));
  if (!built) return { outcome: "not_installed", origin: null };
  if (await dependencies.probeHealth(LOCAL_HUB_ORIGIN)) {
    return { outcome: "already_running", origin: LOCAL_HUB_ORIGIN };
  }
  await startBuiltHub(
    dependencies,
    checkout,
    localHubDataDirectory(dependencies.paseoHome),
    () => undefined,
  );
  return { outcome: "started", origin: LOCAL_HUB_ORIGIN };
}

async function readInstallState(
  dependencies: HubLocalInstallerDependencies,
): Promise<HubLocalInstallState> {
  const checkout = localHubCheckoutDirectory(dependencies.paseoHome);
  const installed = await dependencies.fileExists(path.join(checkout, "dist", "index.js"));
  const running = await dependencies.probeHealth(LOCAL_HUB_ORIGIN);
  return {
    installed,
    running,
    origin: running ? LOCAL_HUB_ORIGIN : null,
  };
}

async function runInstall(
  dependencies: HubLocalInstallerDependencies,
  onProgress: (progress: HubLocalInstallProgress) => void,
): Promise<HubLocalInstallState> {
  const checkout = localHubCheckoutDirectory(dependencies.paseoHome);
  const dataDirectory = localHubDataDirectory(dependencies.paseoHome);
  const report = (phase: HubLocalInstallPhase, lines = 0) => {
    onProgress({ phase, percent: hubInstallPercent(phase, lines) });
  };

  report("preparing");
  const alreadyRunning = await dependencies.probeHealth(LOCAL_HUB_ORIGIN);
  const built = await dependencies.fileExists(path.join(checkout, "dist", "index.js"));
  if (alreadyRunning && built) {
    report("ready");
    return { installed: true, running: true, origin: LOCAL_HUB_ORIGIN };
  }
  if (built) {
    return startBuiltHub(dependencies, checkout, dataDirectory, onProgress);
  }

  await mkdir(checkout, { recursive: true });
  await mkdir(dataDirectory, { recursive: true });
  const cloned = await dependencies.fileExists(path.join(checkout, ".git"));
  if (!cloned) {
    let lines = 0;
    report("downloading");
    await dependencies.run(
      {
        command: "git",
        args: ["clone", "--depth", "1", "--", HUB_GITHUB_CLONE_URL, checkout],
        cwd: path.dirname(checkout),
      },
      () => {
        lines += 1;
        report("downloading", lines);
      },
    );
  }

  const tools = dependencies.resolveTools
    ? await dependencies.resolveTools()
    : await resolveInstallTools();
  let installLines = 0;
  report("installing");
  await dependencies.run({ command: tools.npm, args: ["install"], cwd: checkout }, () => {
    installLines += 1;
    report("installing", installLines);
  });
  await dependencies.run({ command: tools.npm, args: ["run", "build"], cwd: checkout }, () => {
    installLines += 1;
    report("installing", installLines);
  });

  if (!alreadyRunning) {
    report("starting");
    await dependencies.start(checkout, dataDirectory, tools.node);
    const healthy = await waitForHealth(dependencies.probeHealth, (waitedMs) => {
      onProgress({ phase: "starting", percent: hubStartupWaitPercent(waitedMs) });
    });
    if (!healthy) throw hubNotReadyError();
  }

  report("ready");
  return { installed: true, running: true, origin: LOCAL_HUB_ORIGIN };
}

/**
 * Starts a checkout that already has a build. Closing the app stops the
 * process and leaves the files in place, so the next open must not clone or
 * install again.
 *
 * @param dependencies - Process hooks
 * @param checkout - Existing Hub checkout
 * @param dataDirectory - Hub data directory
 * @param onProgress - Progress callback
 * @returns Running install state
 */
async function startBuiltHub(
  dependencies: HubLocalInstallerDependencies,
  checkout: string,
  dataDirectory: string,
  onProgress: (progress: HubLocalInstallProgress) => void,
): Promise<HubLocalInstallState> {
  const tools = dependencies.resolveTools
    ? await dependencies.resolveTools()
    : await resolveInstallTools();
  onProgress({ phase: "starting", percent: hubInstallPercent("starting", 0) });
  await dependencies.start(checkout, dataDirectory, tools.node);
  const healthy = await waitForHealth(dependencies.probeHealth, (waitedMs) => {
    onProgress({ phase: "starting", percent: hubStartupWaitPercent(waitedMs) });
  });
  if (!healthy) throw hubNotReadyError();
  onProgress({ phase: "ready", percent: hubInstallPercent("ready", 0) });
  return { installed: true, running: true, origin: LOCAL_HUB_ORIGIN };
}

/**
 * npm and node used to build and launch Hub.
 *
 * The desktop daemon runs inside Electron, so the executable beside
 * `process.execPath` is not npm. That lookup is `electron/dist/npm` and fails
 * with ENOENT. Electron uses the npm on PATH, and Hub then starts with the
 * node that sits next to it. A daemon started by Node keeps the npm beside
 * that runtime.
 *
 * @param input - Runtime location and the tools discovered on disk or PATH
 * @returns Absolute npm and node paths
 */
export function installToolPaths(input: {
  execPath: string;
  electron: boolean;
  siblingNpmExists: boolean;
  npmOnPath: string;
  siblingNodeExists: boolean;
  nodeOnPath: string | null;
}): { npm: string; node: string } {
  const siblingNpm = path.join(path.dirname(input.execPath), toolFileName("npm"));
  const npm = !input.electron && input.siblingNpmExists ? siblingNpm : input.npmOnPath;
  if (!input.electron) {
    return { npm, node: input.execPath };
  }
  const siblingNode = path.join(path.dirname(npm), toolFileName("node"));
  if (input.siblingNodeExists) {
    return { npm, node: siblingNode };
  }
  if (input.nodeOnPath === null) {
    throw new Error("Não foi possível encontrar o Node neste computador.");
  }
  return { npm, node: input.nodeOnPath };
}

function toolFileName(name: "npm" | "node"): string {
  if (process.platform !== "win32") return name;
  return name === "npm" ? "npm.cmd" : "node.exe";
}

async function resolveInstallTools(): Promise<{ npm: string; node: string }> {
  const electron = process.versions.electron !== undefined;
  const siblingNpm = path.join(path.dirname(process.execPath), toolFileName("npm"));
  const siblingNpmExists = await fileExists(siblingNpm);
  const npmOnPath = !electron && siblingNpmExists ? siblingNpm : await findExecutable("npm");
  if (npmOnPath === null) {
    throw new Error("Não foi possível encontrar o npm neste computador.");
  }
  const siblingNode = path.join(path.dirname(npmOnPath), toolFileName("node"));
  return installToolPaths({
    execPath: process.execPath,
    electron,
    siblingNpmExists,
    npmOnPath,
    siblingNodeExists: await fileExists(siblingNode),
    nodeOnPath: electron ? await findExecutable("node") : process.execPath,
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function probeHealth(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return isHealthOk(body);
  } catch {
    return false;
  }
}

function isHealthOk(body: unknown): boolean {
  return typeof body === "object" && body !== null && "ok" in body && body.ok === true;
}

async function waitForHealth(
  probe: (origin: string) => Promise<boolean>,
  onWait: (waitedMs: number) => void,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < LOCAL_HUB_READY_TIMEOUT_MS) {
    if (hubProcessExit !== null) return false;
    if (await probe(LOCAL_HUB_ORIGIN)) return true;
    if (hubProcessExit !== null) return false;
    const waitedMs = Date.now() - startedAt;
    if (waitedMs >= LOCAL_HUB_READY_TIMEOUT_MS) return false;
    onWait(waitedMs);
    const remainingMs = LOCAL_HUB_READY_TIMEOUT_MS - waitedMs;
    await delay(Math.min(HEALTH_POLL_INTERVAL_MS, remainingMs));
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Runs one install command and forwards each output line.
 *
 * @param command - Executable and arguments
 * @param onLine - Called for each non-empty stdout or stderr line
 * @returns Nothing
 */
export function runHubInstallCommand(
  command: HubInstallCommand,
  onLine: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, [...command.args], {
      cwd: command.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let errorText = "";
    const consume = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      errorText += text;
      for (const line of text.split(/\r?\n/u)) {
        if (line.trim().length > 0) onLine(line);
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(errorText.trim().slice(-400) || `command exited ${String(code)}`));
    });
  });
}

/**
 * Environment for the local Hub process.
 *
 * The daemon inherits project variables such as DATABASE_URL. Hub treats that
 * variable as an order to use PostgreSQL, then exits when that server is not
 * the embedded database in the data directory. Health checks only see a dead
 * port. The child gets the variables it needs to run and talk to the network,
 * plus the embedded data directory.
 *
 * @param input - Daemon environment and the Hub data directory
 * @returns Environment for the Hub process
 */
export function hubProcessEnvironment(input: {
  baseEnv: NodeJS.ProcessEnv;
  dataDirectory: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of HUB_PROCESS_ENV_KEYS) {
    const value = input.baseEnv[key];
    if (value !== undefined) env[key] = value;
  }
  env.PORT = LOCAL_HUB_PORT;
  env.PASEO_HUB_APP_URL = LOCAL_HUB_ORIGIN;
  env.PASEO_HUB_DATA_DIR = input.dataDirectory;
  env.NODE_ENV = "production";
  return env;
}

/**
 * Message shown when startup does not reach /health.
 *
 * @param exit - Child exit, when the process ended before the timeout
 * @param logTail - Trailing Hub log text
 * @returns Error text for the install response
 */
export function hubNotReadyMessage(exit: HubProcessExit | null, logTail: string): string {
  const reason =
    exit === null
      ? "Hub did not become ready."
      : `Hub exited before it was ready (${exit.signal ?? `code ${String(exit.code)}`}).`;
  const tail = logTail.trim();
  if (tail.length === 0) return reason;
  return `${reason}\n${tail}`;
}

function hubNotReadyError(): Error {
  return new Error(hubNotReadyMessage(hubProcessExit, readHubLogTail()));
}

function localHubLogPath(dataDirectory: string): string {
  return path.join(path.dirname(dataDirectory), "hub.log");
}

function readHubLogTail(): string {
  if (hubLogPath === null) return "";
  try {
    const text = readFileSync(hubLogPath, "utf8");
    return text.length <= HUB_LOG_TAIL_LIMIT ? text.trim() : text.slice(-HUB_LOG_TAIL_LIMIT).trim();
  } catch {
    return "";
  }
}

function stopTrackedHubProcess(): void {
  const child = hubProcess;
  hubProcess = null;
  if (child === null || child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
}

async function startLocalHubProcess(
  checkout: string,
  dataDirectory: string,
  nodePath: string,
): Promise<void> {
  const generation = ++hubGeneration;
  stopTrackedHubProcess();
  hubProcessExit = null;
  const logPath = localHubLogPath(dataDirectory);
  hubLogPath = logPath;
  appendFileSync(logPath, `\n--- ${new Date().toISOString()} starting hub ---\n`, {
    mode: PRIVATE_FILE_MODE,
  });
  ensurePrivateFile(logPath);
  const fd = openSync(logPath, "a", PRIVATE_FILE_MODE);
  let child: ChildProcess;
  try {
    child = spawn(nodePath, [path.join(checkout, "bin", "paseo-hub.js")], {
      cwd: checkout,
      env: hubProcessEnvironment({ baseEnv: process.env, dataDirectory }),
      detached: true,
      stdio: ["ignore", fd, fd],
    });
  } finally {
    closeSync(fd);
  }
  child.unref();
  hubProcess = child;
  child.on("exit", (code, signal) => {
    if (generation !== hubGeneration) return;
    hubProcessExit = { code, signal };
    if (hubProcess === child) hubProcess = null;
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", () => resolve());
  });
}
