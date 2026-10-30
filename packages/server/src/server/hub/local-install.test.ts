import { expect, test } from "vitest";
import {
  HUB_GITHUB_CLONE_URL,
  createHubLocalInstaller,
  hubInstallPercent,
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
    origin: "http://127.0.0.1:3000",
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
    origin: "http://127.0.0.1:3000",
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
