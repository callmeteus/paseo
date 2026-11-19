import { readFileSync } from "node:fs";
import path from "node:path";
import type { McpServerConfig } from "@getpaseo/protocol/messages";

/**
 * The harness owns the MCP connection, but Paseo needs the server config to
 * read an MCP App's `ui://` resource for display. Cursor keeps its servers in
 * the project's `.cursor/mcp.json`; read that file without modifying it.
 */
export function readProjectMcpConfigs(cwd: string): Record<string, McpServerConfig> {
  const file = path.join(cwd, ".cursor", "mcp.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const container = parsed as Record<string, unknown>;
  const servers = container.mcpServers ?? container.servers;
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return {};

  const result: Record<string, McpServerConfig> = {};
  for (const [name, raw] of Object.entries(servers)) {
    const config = substituteWorkspaceFolder(raw, cwd);
    if (isMcpServerConfig(config)) result[name] = config;
  }
  return result;
}

function substituteWorkspaceFolder(value: unknown, cwd: string): unknown {
  if (typeof value === "string") return value.replaceAll("${workspaceFolder}", cwd);
  if (Array.isArray(value)) return value.map((item) => substituteWorkspaceFolder(item, cwd));
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).map(([key, item]) => [
      key,
      key === "envFile" && typeof item === "string"
        ? item.replaceAll("${workspaceFolder}", cwd)
        : substituteWorkspaceFolder(item, cwd),
    ]);
    return Object.fromEntries(entries);
  }
  return value;
}

function isMcpServerConfig(value: unknown): value is McpServerConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  return (
    (config.type === "stdio" && typeof config.command === "string") ||
    (typeof config.url === "string" &&
      (config.type === "http" || config.type === "sse" || config.type === undefined))
  );
}
