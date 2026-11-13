import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import type {
  DetectedMcpServer,
  McpCatalogSource,
  McpServerConfig,
} from "@getpaseo/protocol/messages";

interface ScanOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
  currentServers?: Record<string, McpServerConfig>;
  /** Import re-reads the real values; UI scans get masked env/header values. */
  redact?: boolean;
}

export interface ScanResult {
  servers: DetectedMcpServer[];
  errors: string[];
}

interface SourceFile {
  source: McpCatalogSource;
  path: string;
  read: (path: string) => Promise<unknown>;
}

export async function scanInstalledMcpServers(options: ScanOptions = {}): Promise<ScanResult> {
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const currentServers = options.currentServers ?? {};
  const sources = resolveSources(home, env);
  const servers: DetectedMcpServer[] = [];
  const errors: string[] = [];

  for (const source of sources) {
    let document: unknown;
    try {
      document = await source.read(source.path);
    } catch (error) {
      if (isMissingFile(error)) continue;
      errors.push(`${source.source}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (document === null) continue;
    const entries = extractEntries(source.source, document);
    for (const entry of entries) {
      const normalized = normalizeServer(source.source, entry.value);
      if (!normalized) {
        errors.push(`${source.source}: ignored "${entry.name}" (unsupported configuration)`);
        continue;
      }
      servers.push({
        source: source.source,
        name: entry.name,
        transport: normalized.config.type,
        config:
          options.redact === false
            ? (normalized.config as unknown as Record<string, unknown>)
            : redactConfig(normalized.config),
        sourcePath: source.path,
        warnings: normalized.warnings,
        alreadyConfigured: Object.hasOwn(currentServers, entry.name),
      });
    }
  }

  return {
    servers: servers.sort(
      (left, right) =>
        left.source.localeCompare(right.source) || left.name.localeCompare(right.name),
    ),
    errors,
  };
}

export function redactConfig(config: McpServerConfig): Record<string, unknown> {
  if (config.type === "stdio") {
    return {
      ...config,
      ...(config.env
        ? { env: Object.fromEntries(Object.keys(config.env).map((key) => [key, ""])) }
        : {}),
    };
  }
  return {
    ...config,
    ...(config.headers
      ? { headers: Object.fromEntries(Object.keys(config.headers).map((key) => [key, ""])) }
      : {}),
  };
}

function resolveSources(home: string, env: NodeJS.ProcessEnv): SourceFile[] {
  const claudeConfigDir = env.CLAUDE_CONFIG_DIR?.trim();
  const codexHome = env.CODEX_HOME?.trim();
  const openCodeConfigDir = env.OPENCODE_CONFIG_DIR?.trim();
  const piAgentDir = env.PI_CODING_AGENT_DIR?.trim();
  const cursorDir = env.CURSOR_CONFIG_DIR?.trim() || join(home, ".cursor");
  return [
    {
      source: "claude",
      path: resolve(claudeConfigDir || join(home, ".claude.json")),
      read: readJson,
    },
    { source: "cursor", path: join(cursorDir, "mcp.json"), read: readJson },
    {
      source: "codex",
      path: join(codexHome || join(home, ".codex"), "config.toml"),
      read: readToml,
    },
    {
      source: "opencode",
      path: join(openCodeConfigDir || join(home, ".config", "opencode"), "opencode.json"),
      read: readJsonc,
    },
    {
      source: "opencode",
      path: join(openCodeConfigDir || join(home, ".config", "opencode"), "opencode.jsonc"),
      read: readJsonc,
    },
    {
      source: "pi",
      path: join(piAgentDir || join(home, ".pi", "agent"), "mcp.json"),
      read: readJson,
    },
  ];
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readJsonc(filePath: string): Promise<unknown> {
  const text = await readFile(filePath, "utf8");
  const errors: ParseError[] = [];
  const value = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    throw new Error(`Invalid JSONC at ${filePath}`);
  }
  return value;
}

async function readToml(filePath: string): Promise<unknown> {
  return parseToml(await readFile(filePath, "utf8"));
}

function extractEntries(
  source: McpCatalogSource,
  document: unknown,
): Array<{ name: string; value: unknown }> {
  const record = asRecord(document);
  if (!record) return [];
  let servers: unknown;
  if (source === "opencode") {
    const mcp = asRecord(record.mcp);
    servers = mcp?.servers;
  } else if (source === "codex") {
    servers = record.mcp_servers;
  } else {
    servers = record.mcpServers;
  }
  const serversRecord = asRecord(servers);
  if (!serversRecord) return [];
  return Object.entries(serversRecord).map(([name, value]) => ({ name, value }));
}

function normalizeServer(
  source: McpCatalogSource,
  value: unknown,
): { config: McpServerConfig; warnings: string[] } | null {
  const record = asRecord(value);
  if (!record) return null;
  if (source === "codex") return normalizeCodexServer(record);
  if (source === "opencode") return normalizeOpenCodeServer(record);
  return normalizeStandardServer(record);
}

function normalizeStandardServer(record: Record<string, unknown>): {
  config: McpServerConfig;
  warnings: string[];
} | null {
  const type = typeof record.type === "string" ? record.type : undefined;
  const url = typeof record.url === "string" ? record.url : undefined;
  const command = typeof record.command === "string" ? record.command : undefined;
  const headers = readStringRecord(record.headers);
  const args = readStringArray(record.args);
  const env = readStringRecord(record.env);
  const cwd = typeof record.cwd === "string" ? record.cwd : undefined;
  if (type === "http" || (type === undefined && url && !command)) {
    if (!url) return null;
    return { config: { type: "http", url, ...(headers ? { headers } : {}) }, warnings: [] };
  }
  if (type === "sse") {
    if (!url) return null;
    return { config: { type: "sse", url, ...(headers ? { headers } : {}) }, warnings: [] };
  }
  if (command) {
    return {
      config: {
        type: "stdio",
        command,
        ...(args ? { args } : {}),
        ...(env ? { env } : {}),
        ...(cwd ? { cwd } : {}),
      },
      warnings: [],
    };
  }
  return null;
}

function normalizeCodexServer(record: Record<string, unknown>): {
  config: McpServerConfig;
  warnings: string[];
} | null {
  const url = typeof record.url === "string" ? record.url : undefined;
  const command = typeof record.command === "string" ? record.command : undefined;
  const headers = readStringRecord(record.http_headers) ?? readStringRecord(record.headers);
  const env = readStringRecord(record.env);
  const args = readStringArray(record.args);
  const cwd = typeof record.cwd === "string" ? record.cwd : undefined;
  const warnings = [
    record.enabled_tools !== undefined || record.tools !== undefined
      ? "Tool policy from Codex is not imported."
      : null,
  ].filter((warning): warning is string => warning !== null);
  if (url) {
    return {
      config: { type: "http", url, ...(headers ? { headers } : {}) },
      warnings,
    };
  }
  if (command) {
    return {
      config: {
        type: "stdio",
        command,
        ...(args ? { args } : {}),
        ...(env ? { env } : {}),
        ...(cwd ? { cwd } : {}),
      },
      warnings,
    };
  }
  return null;
}

function normalizeOpenCodeServer(record: Record<string, unknown>): {
  config: McpServerConfig;
  warnings: string[];
} | null {
  const type = typeof record.type === "string" ? record.type : undefined;
  const url = typeof record.url === "string" ? record.url : undefined;
  const commandValue = record.command;
  const commandArray = Array.isArray(commandValue)
    ? commandValue.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  const command =
    typeof commandValue === "string" ? commandValue : (commandArray?.[0] ?? undefined);
  const args =
    commandArray && commandArray.length > 1 ? commandArray.slice(1) : readStringArray(record.args);
  const env = readStringRecord(record.environment) ?? readStringRecord(record.env);
  const headers = readStringRecord(record.headers);
  const warnings = record.enabled === false ? ["This server is disabled in OpenCode."] : [];
  if (type === "remote" || (url && !command)) {
    if (!url) return null;
    return { config: { type: "http", url, ...(headers ? { headers } : {}) }, warnings };
  }
  if (command) {
    return {
      config: {
        type: "stdio",
        command,
        ...(args && args.length > 0 ? { args } : {}),
        ...(env ? { env } : {}),
      },
      warnings,
    };
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const strings = Object.entries(record).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return strings.length > 0 ? Object.fromEntries(strings) : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === "string");
  return strings.length > 0 ? strings : undefined;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
