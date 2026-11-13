import type { McpCatalogImportTarget, McpServerConfig } from "@getpaseo/protocol/messages";
import { McpServerConfigSchema } from "@getpaseo/protocol/messages";
import type { UpstreamMcpRegistry } from "./upstream.js";
import { scanInstalledMcpServers } from "./import-scanner.js";

export interface McpCatalogServiceOptions {
  home: string;
  env: NodeJS.ProcessEnv;
  getServers: () => Record<string, McpServerConfig>;
  patchConfig: (patch: { mcpServers: Record<string, McpServerConfig> }) => Promise<unknown>;
  upstream: UpstreamMcpRegistry;
}

export interface McpCatalogImportResult {
  imported: string[];
  skipped: string[];
  errors: string[];
}

export class McpCatalogService {
  constructor(private readonly options: McpCatalogServiceOptions) {}

  async scan() {
    return scanInstalledMcpServers({
      home: this.options.home,
      env: this.options.env,
      currentServers: this.options.getServers(),
    });
  }

  async importEntries(targets: readonly McpCatalogImportTarget[]): Promise<McpCatalogImportResult> {
    const discovered = await scanInstalledMcpServers({
      home: this.options.home,
      env: this.options.env,
      currentServers: this.options.getServers(),
      redact: false,
    });
    const imported: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];
    const next = { ...this.options.getServers() };

    for (const target of targets) {
      if (Object.hasOwn(next, target.name) && target.replace !== true) {
        skipped.push(target.name);
        continue;
      }
      const match = discovered.servers.find(
        (server) =>
          server.source === target.source &&
          server.name === target.name &&
          server.sourcePath === target.sourcePath,
      );
      if (!match) {
        errors.push(`${target.source}/${target.name}: not found in ${target.sourcePath}`);
        continue;
      }
      const parsed = McpServerConfigSchema.safeParse(match.config);
      if (!parsed.success) {
        errors.push(`${target.source}/${target.name}: invalid MCP configuration`);
        continue;
      }
      next[target.name] = parsed.data;
      imported.push(target.name);
    }

    if (imported.length > 0) {
      await this.options.patchConfig({ mcpServers: next });
    }

    return { imported, skipped, errors };
  }

  async test(config: unknown): Promise<{ ok: boolean; tools: string[]; error: string | null }> {
    const parsed = McpServerConfigSchema.safeParse(config);
    if (!parsed.success) {
      return { ok: false, tools: [], error: "Invalid MCP configuration" };
    }
    try {
      const { tools } = await this.options.upstream.testConfig(parsed.data);
      return { ok: true, tools, error: null };
    } catch (error) {
      return {
        ok: false,
        tools: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
