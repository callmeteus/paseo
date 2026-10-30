import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import type { HubLocalInstallPhase } from "@getpaseo/protocol/messages";
import { findExecutable } from "../../executable-resolution/executable-resolution.js";

/** The automations tab installs Hub from this public fork. */
export const HUB_GITHUB_REPOSITORY = "callmeteus/paseo-hub";
export const HUB_GITHUB_CLONE_URL = "https://github.com/callmeteus/paseo-hub.git";
export const LOCAL_HUB_ORIGIN = "http://127.0.0.1:3000";
export const LOCAL_HUB_PORT = "3000";

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

export interface HubLocalInstaller {
  status(): Promise<HubLocalInstallState>;
  install(onProgress: (progress: HubLocalInstallProgress) => void): Promise<HubLocalInstallState>;
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

let activeInstall: Promise<HubLocalInstallState> | null = null;
let hubProcess: ChildProcess | null = null;

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
  };
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
    return startBuiltHub(dependencies, checkout, dataDirectory, report);
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
    const healthy = await waitForHealth(dependencies.probeHealth);
    if (!healthy) {
      throw new Error("Hub did not become ready.");
    }
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
 * @param report - Progress callback
 * @returns Running install state
 */
async function startBuiltHub(
  dependencies: HubLocalInstallerDependencies,
  checkout: string,
  dataDirectory: string,
  report: (phase: HubLocalInstallPhase, lines?: number) => void,
): Promise<HubLocalInstallState> {
  const tools = dependencies.resolveTools
    ? await dependencies.resolveTools()
    : await resolveInstallTools();
  report("starting");
  await dependencies.start(checkout, dataDirectory, tools.node);
  const healthy = await waitForHealth(dependencies.probeHealth);
  if (!healthy) {
    throw new Error("Hub did not become ready.");
  }
  report("ready");
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

async function waitForHealth(probe: (origin: string) => Promise<boolean>): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await probe(LOCAL_HUB_ORIGIN)) return true;
    await delay(1_000);
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

async function startLocalHubProcess(
  checkout: string,
  dataDirectory: string,
  nodePath: string,
): Promise<void> {
  if (hubProcess !== null && hubProcess.exitCode === null && !hubProcess.killed) return;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: LOCAL_HUB_PORT,
    PASEO_HUB_APP_URL: LOCAL_HUB_ORIGIN,
    PASEO_HUB_DATA_DIR: dataDirectory,
  };
  // Hub is a Node server. The desktop daemon's executable is Electron.
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(nodePath, [path.join(checkout, "bin", "paseo-hub.js")], {
    cwd: checkout,
    env,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  hubProcess = child;
}
