import { expect, test } from "vitest";
import {
  HUB_GITHUB_CLONE_URL,
  LOCAL_HUB_ORIGIN,
  LOCAL_HUB_READY_TIMEOUT_MS,
  createHubLocalInstaller,
  hubInstallPercent,
  hubNotReadyMessage,
  hubProcessEnvironment,
  hubStartupWaitPercent,
  installToolPaths,
  type HubInstallCommand,
  type HubLocalInstallerDependencies,
} from "./local-install.js";

test("install percent stays inside the phase range", () => {
  expect(hubInstallPercent("preparing", 0)).toBe(5);
  expect(hubInstallPercent("downloading", 0)).toBe(15);
  expect(hubInstallPercent("downloading", 100)).toBe(39);
  expect(hubInstallPercent("installing", 8)).toBe(42);
  expect(hubInstallPercent("ready", 0)).toBe(100);
});

test("startup wait percent climbs across the 90 second health window", () => {
  expect(LOCAL_HUB_READY_TIMEOUT_MS).toBe(90_000);
  expect(hubStartupWaitPercent(0)).toBe(88);
  expect(hubStartupWaitPercent(45_000)).toBe(93);
  expect(hubStartupWaitPercent(LOCAL_HUB_READY_TIMEOUT_MS)).toBe(99);
});

test("install clones callmeteus/paseo-hub, builds it, and starts it", async () => {
  const commands: HubInstallCommand[] = [];
  const phases: string[] = [];
  const files = new Set<string>();
  let started = false;
  let healthy = false;
  const dependencies: HubLocalInstallerDependencies = {
    paseoHome: "/tmp/paseo-home",
    fileExists: async (filePath) => files.has(filePath),
    probeHealth: async () => healthy,
    run: async (command) => {
      commands.push(command);
      if (command.args[0] === "clone") {
        files.add("/tmp/paseo-home/hub-app/.git");
      }
      if (command.args[0] === "run") {
        files.add("/tmp/paseo-home/hub-app/dist/index.js");
        healthy = true;
      }
    },
    start: async () => {
      started = true;
    },
    resolveTools: async () => ({ npm: "/usr/bin/npm", node: "/usr/bin/node" }),
  };

  const result = await createHubLocalInstaller(dependencies).install((progress) => {
    phases.push(progress.phase);
  });

  expect(
    commands.map((command) =>
      command.command === "git" ? command.args.slice(0, 3) : [command.args[0]],
    ),
  ).toEqual([["clone", "--depth", "1"], ["install"], ["run"]]);
  expect(commands[0]?.args.at(-1)).toBe("/tmp/paseo-home/hub-app");
  expect(commands[0]?.args).toContain(HUB_GITHUB_CLONE_URL);
  expect(started).toBe(true);
  expect(phases.at(0)).toBe("preparing");
  expect(phases).toContain("downloading");
  expect(phases).toContain("installing");
  expect(phases.at(-1)).toBe("ready");
  expect(result).toEqual({
    installed: true,
    running: true,
    origin: LOCAL_HUB_ORIGIN,
  });
});

test("a built checkout starts without cloning or installing again", async () => {
  const commands: HubInstallCommand[] = [];
  const phases: string[] = [];
  const files = new Set(["/tmp/paseo-home/hub-app/.git", "/tmp/paseo-home/hub-app/dist/index.js"]);
  let started = false;
  let healthy = false;
  const dependencies: HubLocalInstallerDependencies = {
    paseoHome: "/tmp/paseo-home",
    fileExists: async (filePath) => files.has(filePath),
    probeHealth: async () => healthy,
    run: async (command) => {
      commands.push(command);
    },
    start: async () => {
      started = true;
      healthy = true;
    },
    resolveTools: async () => ({ npm: "/usr/bin/npm", node: "/usr/bin/node" }),
  };

  const result = await createHubLocalInstaller(dependencies).install((progress) => {
    phases.push(progress.phase);
  });

  expect(commands).toEqual([]);
  expect(started).toBe(true);
  expect(phases).toEqual(["preparing", "starting", "ready"]);
  expect(result).toEqual({
    installed: true,
    running: true,
    origin: LOCAL_HUB_ORIGIN,
  });
});

test("desktop Electron does not look for npm beside its own binary", () => {
  const tools = installToolPaths({
    execPath: "/mnt/ssd2/software/paseo/node_modules/electron/dist/electron",
    electron: true,
    siblingNpmExists: false,
    npmOnPath: "/home/gio/.nvm/versions/node/v25.2.1/bin/npm",
    siblingNodeExists: true,
    nodeOnPath: "/home/gio/.nvm/versions/node/v25.2.1/bin/node",
  });

  expect(tools).toEqual({
    npm: "/home/gio/.nvm/versions/node/v25.2.1/bin/npm",
    node: "/home/gio/.nvm/versions/node/v25.2.1/bin/node",
  });
});

test("local Hub process drops the daemon's database and node options", () => {
  const env = hubProcessEnvironment({
    baseEnv: {
      HOME: "/home/gio",
      PATH: "/usr/bin",
      LANG: "pt_BR.UTF-8",
      DATABASE_URL: "postgres://paseo:secret@127.0.0.1:5432/other",
      NODE_OPTIONS: "--require /tmp/preload.js",
      ELECTRON_RUN_AS_NODE: "1",
      PASEO_HUB_BIND: "100.66.222.98",
    },
    dataDirectory: "/home/gio/.paseo/hub-data",
  });

  expect(env.DATABASE_URL).toBeUndefined();
  expect(env.NODE_OPTIONS).toBeUndefined();
  expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  expect(env.PASEO_HUB_BIND).toBeUndefined();
  expect(env).toMatchObject({
    HOME: "/home/gio",
    PATH: "/usr/bin",
    LANG: "pt_BR.UTF-8",
    PORT: "25000",
    PASEO_HUB_APP_URL: LOCAL_HUB_ORIGIN,
    PASEO_HUB_DATA_DIR: "/home/gio/.paseo/hub-data",
    NODE_ENV: "production",
  });
});

test("a Hub that exits reports that exit and the log tail", () => {
  expect(hubNotReadyMessage(null, "")).toBe("Hub did not become ready.");
  expect(hubNotReadyMessage({ code: 1, signal: null }, "database connection failed")).toBe(
    "Hub exited before it was ready (code 1).\ndatabase connection failed",
  );
  expect(hubNotReadyMessage({ code: null, signal: "SIGTERM" }, "  ")).toBe(
    "Hub exited before it was ready (SIGTERM).",
  );
});

test("a Node daemon keeps the npm beside that runtime", () => {
  expect(
    installToolPaths({
      execPath: "/usr/local/bin/node",
      electron: false,
      siblingNpmExists: true,
      npmOnPath: "/somewhere/else/npm",
      siblingNodeExists: false,
      nodeOnPath: null,
    }),
  ).toEqual({
    npm: "/usr/local/bin/npm",
    node: "/usr/local/bin/node",
  });
});

test("a missing Hub build is not cloned or started", async () => {
  const commands: HubInstallCommand[] = [];
  let started = false;
  const result = await createHubLocalInstaller({
    paseoHome: "/tmp/paseo-home",
    fileExists: async () => false,
    probeHealth: async () => false,
    run: async (command) => {
      commands.push(command);
    },
    start: async () => {
      started = true;
    },
    resolveTools: async () => ({ npm: "/usr/bin/npm", node: "/usr/bin/node" }),
  }).startInstalled();

  expect(result).toEqual({ outcome: "not_installed", origin: null });
  expect(commands).toEqual([]);
  expect(started).toBe(false);
});

test("an installed Hub that is already running is left alone", async () => {
  let started = false;
  const result = await createHubLocalInstaller({
    paseoHome: "/tmp/paseo-home",
    fileExists: async (filePath) => filePath.endsWith("dist/index.js"),
    probeHealth: async () => true,
    run: async () => undefined,
    start: async () => {
      started = true;
    },
  }).startInstalled();

  expect(result).toEqual({ outcome: "already_running", origin: LOCAL_HUB_ORIGIN });
  expect(started).toBe(false);
});

test("an installed Hub that is stopped starts without cloning", async () => {
  const commands: HubInstallCommand[] = [];
  let healthy = false;
  const result = await createHubLocalInstaller({
    paseoHome: "/tmp/paseo-home",
    fileExists: async (filePath) => filePath.endsWith("dist/index.js"),
    probeHealth: async () => healthy,
    run: async (command) => {
      commands.push(command);
    },
    start: async () => {
      healthy = true;
    },
    resolveTools: async () => ({ npm: "/usr/bin/npm", node: "/usr/bin/node" }),
  }).startInstalled();

  expect(commands).toEqual([]);
  expect(result).toEqual({ outcome: "started", origin: LOCAL_HUB_ORIGIN });
});

test("status reports a checkout that has not been built", async () => {
  const status = await createHubLocalInstaller({
    paseoHome: "/tmp/paseo-home",
    fileExists: async () => false,
    probeHealth: async () => false,
    run: async () => undefined,
    start: async () => undefined,
  }).status();

  expect(status).toEqual({ installed: false, running: false, origin: null });
});
