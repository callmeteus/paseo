import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Logger } from "pino";

/**
 * Cursor ACP loads MCP servers from `~/.cursor/mcp.json`, but it does not load
 * Cursor plugins, so plugin-provided MCP servers (Slack, ask/dialog tools, and
 * any other marketplace plugin) are missing from Paseo sessions.
 *
 * Mirror every installed plugin's MCP definition into the user's Cursor config
 * before Cursor starts. Entries already present in the config are never
 * replaced, and entries this bridge wrote are reconciled when a plugin is
 * removed or its definition changes.
 */

const PLUGIN_MANIFEST = join(".cursor-plugin", "plugin.json");
const MANAGED_STATE_FILE = ".paseo-mcp-bridge-state.json";
const MAX_PLUGIN_DEPTH = 4;
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "resources", "tools"]);

interface ManagedState {
  managed: Record<string, unknown>;
}

export interface CursorMcpConfigBridge {
  /** Merge installed Cursor plugin MCP servers into the config Cursor reads. */
  acquire(): Promise<void>;
}

export interface CursorMcpConfigBridgeOptions {
  logger: Logger;
  env?: NodeJS.ProcessEnv;
  /** Overrides the Cursor config directory (tests). */
  configDir?: string;
  /** Overrides the Cursor plugins directory (tests). */
  pluginsDir?: string;
}

export function cursorConfigDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CURSOR_CONFIG_DIR?.trim();
  return override ? resolve(override) : join(homedir(), ".cursor");
}

let bridgeQueue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = bridgeQueue.then(task, task);
  bridgeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function createCursorMcpConfigBridge(
  options: CursorMcpConfigBridgeOptions,
): CursorMcpConfigBridge {
  const configDir = options.configDir ?? cursorConfigDirectory(options.env);
  const pluginsDir = options.pluginsDir ?? join(configDir, "plugins");
  return {
    acquire: () =>
      serialize(async () => {
        await mirrorPluginMcpServers({
          configDir,
          pluginsDir,
          logger: options.logger,
        });
      }),
  };
}

async function mirrorPluginMcpServers(input: {
  configDir: string;
  pluginsDir: string;
  logger: Logger;
}): Promise<void> {
  const pluginServers = await discoverPluginMcpServers(input.pluginsDir, input.logger);
  const configPath = join(input.configDir, "mcp.json");
  const statePath = join(input.configDir, MANAGED_STATE_FILE);

  const loaded = await readJsonObject(configPath, input.logger);
  const state = await readManagedState(statePath, input.logger);
  if (Object.keys(pluginServers).length === 0 && Object.keys(state.managed).length === 0) {
    return;
  }

  let config: Record<string, unknown>;
  if (loaded === null) {
    if (await isFile(configPath)) {
      // A malformed config belongs to the user. Do not replace it.
      input.logger.warn("Cursor mcp.json is not valid JSON; skipping plugin MCP bridge");
      return;
    }
    config = {};
  } else {
    config = loaded;
  }
  const configuredServers = config.mcpServers;
  if (configuredServers !== undefined && !isRecord(configuredServers)) {
    input.logger.warn(
      "Cursor mcp.json has a non-object mcpServers value; skipping plugin MCP bridge",
    );
    return;
  }
  const existingServers = { ...configuredServers };
  const nextManaged: Record<string, unknown> = {};
  let configChanged = false;

  for (const [name, server] of Object.entries(pluginServers)) {
    const current = existingServers[name];
    if (current === undefined) {
      existingServers[name] = server;
      nextManaged[name] = server;
      configChanged = true;
      continue;
    }
    if (jsonEqual(current, server)) {
      nextManaged[name] = server;
      continue;
    }
    // The user (or another plugin) defines this name differently. Leave it alone.
    if (jsonEqual(current, state.managed[name])) {
      existingServers[name] = server;
      nextManaged[name] = server;
      configChanged = true;
    }
  }

  for (const [name, server] of Object.entries(state.managed)) {
    if (Object.hasOwn(nextManaged, name)) continue;
    if (!jsonEqual(existingServers[name], server)) continue;
    delete existingServers[name];
    configChanged = true;
  }

  const stateChanged = !jsonEqual(state.managed, nextManaged);
  if (configChanged) {
    config.mcpServers = existingServers;
    await writeJsonAtomically(configPath, config);
  }
  if (stateChanged) {
    await writeJsonAtomically(statePath, { managed: nextManaged } satisfies ManagedState);
  }
}

async function discoverPluginMcpServers(
  pluginsDir: string,
  logger: Logger,
): Promise<Record<string, unknown>> {
  const manifests = await findPluginManifests(pluginsDir);
  const servers: Record<string, unknown> = {};
  for (const manifestPath of manifests) {
    const declared = await loadPluginServers(manifestPath, logger);
    for (const [name, server] of Object.entries(declared)) {
      if (Object.hasOwn(servers, name)) {
        logger.debug(
          { plugin: manifestPath, server: name },
          "Skipping duplicate plugin MCP server",
        );
        continue;
      }
      servers[name] = server;
    }
  }
  return servers;
}

async function findPluginManifests(root: string, depth = 0): Promise<string[]> {
  if (depth > MAX_PLUGIN_DEPTH) return [];
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const manifests: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const directory = join(root, entry.name);
    const manifestPath = join(directory, PLUGIN_MANIFEST);
    if (await isFile(manifestPath)) {
      manifests.push(manifestPath);
    }
    manifests.push(...(await findPluginManifests(directory, depth + 1)));
  }
  return manifests;
}

async function loadPluginServers(
  manifestPath: string,
  logger: Logger,
): Promise<Record<string, unknown>> {
  const manifest = await readJsonObject(manifestPath, logger);
  if (!manifest) return {};

  const manifestDir = dirname(manifestPath);
  const pluginRoot = dirname(manifestDir);
  const declared = manifest.mcpServers;
  const sources: unknown[] = [];
  if (typeof declared === "string") {
    // Plugin manifests resolve MCP files from either the manifest directory or
    // the plugin root depending on the marketplace.
    sources.push(resolve(manifestDir, declared), resolve(pluginRoot, declared));
  } else if (Array.isArray(declared)) {
    sources.push(...declared);
  } else if (isRecord(declared)) {
    sources.push(declared);
  }

  if (sources.length === 0) {
    // Some plugin manifests keep the server config at the plugin root instead.
    sources.push(join(manifestDir, ".mcp.json"), join(pluginRoot, ".mcp.json"));
  }

  const servers: Record<string, unknown> = {};
  for (const source of sources) {
    if (typeof source === "string") {
      const file = await readJsonObject(source, logger);
      if (file) mergeServers(servers, file.mcpServers);
      continue;
    }
    if (!isRecord(source)) continue;
    if (isRecord(source.mcpServers)) mergeServers(servers, source.mcpServers);
    else mergeServers(servers, source);
  }
  return servers;
}

function mergeServers(target: Record<string, unknown>, value: unknown): void {
  if (!isRecord(value)) return;
  for (const [name, server] of Object.entries(value)) {
    if (!isRecord(server)) continue;
    target[name] = server;
  }
}

async function readJsonObject(
  path: string,
  logger: Logger,
): Promise<Record<string, unknown> | null> {
  try {
    const text = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch (error) {
    const code = isRecord(error) && typeof error.code === "string" ? error.code : undefined;
    if (code !== "ENOENT") {
      logger.debug({ err: error, path }, "Could not read Cursor MCP config");
    }
    return null;
  }
}

async function readManagedState(path: string, logger: Logger): Promise<ManagedState> {
  const value = await readJsonObject(path, logger);
  return {
    managed: value && isRecord(value.managed) ? value.managed : {},
  };
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.paseo-${process.pid}-${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
