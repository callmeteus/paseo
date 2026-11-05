import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Logger } from "pino";
import { afterEach, describe, expect, test } from "vitest";

import { createCursorMcpConfigBridge } from "./cursor-mcp-config.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function createLogger(): Logger {
  const logger = {
    child: () => logger,
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
  };
  return logger as unknown as Logger;
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "paseo-cursor-mcp-"));
  directories.push(root);
  return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function installPlugin(
  root: string,
  plugin: string,
  servers: Record<string, unknown>,
): Promise<void> {
  const pluginRoot = join(root, "plugins", "cache", "cursor-public", plugin);
  await writeJson(join(pluginRoot, ".cursor-plugin", "plugin.json"), {
    mcpServers: "../.cursor-mcp.json",
  });
  await writeJson(join(pluginRoot, ".cursor-mcp.json"), { mcpServers: servers });
}

function bridge(root: string) {
  return createCursorMcpConfigBridge({
    configDir: root,
    pluginsDir: join(root, "plugins"),
    logger: createLogger(),
  });
}

const slackServer = {
  url: "https://mcp.slack.com/mcp",
  auth: { CLIENT_ID: "client-id" },
};

describe("Cursor plugin MCP bridge", () => {
  test("mirrors installed plugin servers while preserving user entries", async () => {
    const root = await createRoot();
    await writeJson(join(root, "mcp.json"), {
      mcpServers: { grafana: { type: "http", url: "https://grafana.test/mcp" } },
    });
    await installPlugin(root, "slack", { slack: slackServer });

    await bridge(root).acquire();

    expect(await readJson(join(root, "mcp.json"))).toEqual({
      mcpServers: {
        grafana: { type: "http", url: "https://grafana.test/mcp" },
        slack: slackServer,
      },
    });
    expect(await readJson(join(root, ".paseo-mcp-bridge-state.json"))).toEqual({
      managed: { slack: slackServer },
    });
  });

  test("supports manifests that inline their MCP servers", async () => {
    const root = await createRoot();
    const pluginRoot = join(root, "plugins", "local", "dialogs");
    await writeJson(join(pluginRoot, ".cursor-plugin", "plugin.json"), {
      mcpServers: { question: { command: "question-mcp", args: ["--stdio"] } },
    });

    await bridge(root).acquire();

    expect(await readJson(join(root, "mcp.json"))).toEqual({
      mcpServers: { question: { command: "question-mcp", args: ["--stdio"] } },
    });
  });

  test("keeps a user definition when a plugin uses the same server name", async () => {
    const root = await createRoot();
    const userServer = { type: "http", url: "https://user-slack.test/mcp" };
    await writeJson(join(root, "mcp.json"), { mcpServers: { slack: userServer } });
    await installPlugin(root, "slack", { slack: slackServer });

    await bridge(root).acquire();

    expect(await readJson(join(root, "mcp.json"))).toEqual({
      mcpServers: { slack: userServer },
    });
  });

  test("updates its own entry when a plugin definition changes", async () => {
    const root = await createRoot();
    await installPlugin(root, "slack", { slack: slackServer });
    await bridge(root).acquire();

    const updated = { ...slackServer, url: "https://mcp.slack.com/mcp/v2" };
    await installPlugin(root, "slack", { slack: updated });
    await bridge(root).acquire();

    expect(await readJson(join(root, "mcp.json"))).toEqual({
      mcpServers: { slack: updated },
    });
  });

  test("removes managed entries after a plugin is uninstalled", async () => {
    const root = await createRoot();
    await writeJson(join(root, "mcp.json"), {
      mcpServers: { grafana: { type: "http", url: "https://grafana.test/mcp" } },
    });
    await installPlugin(root, "slack", { slack: slackServer });
    await bridge(root).acquire();

    await rm(join(root, "plugins"), { recursive: true });
    await bridge(root).acquire();

    expect(await readJson(join(root, "mcp.json"))).toEqual({
      mcpServers: { grafana: { type: "http", url: "https://grafana.test/mcp" } },
    });
    expect(await readJson(join(root, ".paseo-mcp-bridge-state.json"))).toEqual({ managed: {} });
  });

  test("leaves a malformed user config untouched", async () => {
    const root = await createRoot();
    await writeFile(join(root, "mcp.json"), "{", "utf8");
    await installPlugin(root, "slack", { slack: slackServer });

    await bridge(root).acquire();

    expect(await readFile(join(root, "mcp.json"), "utf8")).toBe("{");
  });
});
