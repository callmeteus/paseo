import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { McpServerConfig } from "@getpaseo/protocol/messages";
import { McpCatalogService } from "./catalog.js";
import type { UpstreamMcpRegistry } from "./upstream.js";

const homes: string[] = [];

async function createHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "paseo-mcp-catalog-"));
  homes.push(home);
  return home;
}

async function seedClaudeConfig(home: string): Promise<void> {
  const path = join(home, ".claude.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({
      mcpServers: {
        github: {
          type: "http",
          url: "https://api.githubcopilot.com/mcp/",
          headers: { Authorization: "Bearer real-token" },
        },
        local: {
          command: "node",
          args: ["server.js"],
          env: { TOKEN: "real-env" },
        },
      },
    }),
    "utf8",
  );
}

function createService(options: {
  home: string;
  getServers?: () => Record<string, McpServerConfig>;
  patchConfig?: (patch: { mcpServers: Record<string, McpServerConfig> }) => Promise<unknown>;
  testConfig?: UpstreamMcpRegistry["testConfig"];
}) {
  const patchConfig = vi.fn(
    options.patchConfig ?? (async (_patch: { mcpServers: Record<string, McpServerConfig> }) => {}),
  );
  const testConfig = vi.fn(
    options.testConfig ??
      (async (_config: McpServerConfig) => ({ tools: ["echo"] }) as { tools: string[] }),
  );
  const service = new McpCatalogService({
    home: options.home,
    env: {},
    getServers: options.getServers ?? (() => ({})),
    patchConfig,
    upstream: { testConfig } as unknown as UpstreamMcpRegistry,
  });
  return { service, patchConfig, testConfig };
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("McpCatalogService", () => {
  test("scans without exposing secret values", async () => {
    const home = await createHome();
    await seedClaudeConfig(home);
    const { service } = createService({ home });

    const result = await service.scan();
    expect(JSON.stringify(result)).not.toContain("real-token");
    expect(JSON.stringify(result)).not.toContain("real-env");
  });

  test("imports the real configuration and keeps existing servers", async () => {
    const home = await createHome();
    await seedClaudeConfig(home);
    const existing: Record<string, McpServerConfig> = {
      filesystem: { type: "stdio", command: "filesystem-mcp" },
    };
    const { service, patchConfig } = createService({
      home,
      getServers: () => existing,
    });

    const result = await service.importEntries([
      { source: "claude", name: "local", sourcePath: join(home, ".claude.json") },
    ]);

    expect(result).toEqual({ imported: ["local"], skipped: [], errors: [] });
    expect(patchConfig).toHaveBeenCalledWith({
      mcpServers: {
        filesystem: { type: "stdio", command: "filesystem-mcp" },
        local: {
          type: "stdio",
          command: "node",
          args: ["server.js"],
          env: { TOKEN: "real-env" },
        },
      },
    });
  });

  test("keeps existing names unless replace is explicit", async () => {
    const home = await createHome();
    await seedClaudeConfig(home);
    const existing: Record<string, McpServerConfig> = {
      github: { type: "http", url: "https://old.example/mcp" },
    };
    const { service, patchConfig } = createService({ home, getServers: () => existing });
    const target = {
      source: "claude" as const,
      name: "github",
      sourcePath: join(home, ".claude.json"),
    };

    await expect(service.importEntries([target])).resolves.toEqual({
      imported: [],
      skipped: ["github"],
      errors: [],
    });
    expect(patchConfig).not.toHaveBeenCalled();

    await expect(service.importEntries([{ ...target, replace: true }])).resolves.toEqual({
      imported: ["github"],
      skipped: [],
      errors: [],
    });
    expect(patchConfig).toHaveBeenCalledWith({
      mcpServers: {
        github: {
          type: "http",
          url: "https://api.githubcopilot.com/mcp/",
          headers: { Authorization: "Bearer real-token" },
        },
      },
    });
  });

  test("reports a target that no longer matches the scanned file", async () => {
    const home = await createHome();
    await seedClaudeConfig(home);
    const { service, patchConfig } = createService({ home });

    const result = await service.importEntries([
      { source: "claude", name: "missing", sourcePath: join(home, ".claude.json") },
    ]);
    expect(result.imported).toEqual([]);
    expect(result.errors[0]).toContain("not found");
    expect(patchConfig).not.toHaveBeenCalled();
  });

  test("tests a config through the upstream registry", async () => {
    const home = await createHome();
    const { service, testConfig } = createService({ home });

    await expect(service.test({ type: "stdio", command: "echo" })).resolves.toEqual({
      ok: true,
      tools: ["echo"],
      error: null,
    });
    expect(testConfig).toHaveBeenCalledWith({ type: "stdio", command: "echo" });

    await expect(service.test({ type: "stdio" })).resolves.toEqual({
      ok: false,
      tools: [],
      error: "Invalid MCP configuration",
    });
  });

  test("returns the upstream error when a test fails", async () => {
    const home = await createHome();
    const { service } = createService({
      home,
      testConfig: async () => {
        throw new Error("boom");
      },
    });

    await expect(service.test({ type: "stdio", command: "echo" })).resolves.toEqual({
      ok: false,
      tools: [],
      error: "boom",
    });
  });
});
