import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { McpServerConfig } from "@getpaseo/protocol/messages";
import { scanInstalledMcpServers } from "./import-scanner.js";

const homes: string[] = [];

async function createHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "paseo-mcp-scan-"));
  homes.push(home);
  return home;
}

async function writeFileAt(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function seedAllSources(home: string): Promise<void> {
  await writeFileAt(
    join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: {
        github: {
          type: "http",
          url: "https://api.githubcopilot.com/mcp/",
          headers: { Authorization: "Bearer claude-secret" },
        },
        local: {
          command: "node",
          args: ["server.js"],
          env: { TOKEN: "claude-env-secret" },
          cwd: "/repo",
        },
      },
    }),
  );
  await writeFileAt(
    join(home, ".cursor", "mcp.json"),
    JSON.stringify({
      mcpServers: {
        playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest"] },
      },
    }),
  );
  await writeFileAt(
    join(home, ".codex", "config.toml"),
    [
      "[mcp_servers.docs]",
      'command = "npx"',
      'args = ["-y", "docs-server"]',
      'env = { DOCS_TOKEN = "codex-secret" }',
      "",
      "[mcp_servers.remote]",
      'url = "https://codex.example/mcp"',
      'http_headers = { Authorization = "Bearer codex-secret" }',
      'enabled_tools = ["search"]',
      "",
    ].join("\n"),
  );
  await writeFileAt(
    join(home, ".config", "opencode", "opencode.jsonc"),
    `{
      // OpenCode keeps MCP servers under mcp.servers.
      "mcp": {
        "servers": {
          "browse": {
            "type": "local",
            "command": ["browse", "mcp"],
            "environment": { "OPENCODE_BROWSER_RUNTIME": "auto-update" }
          },
          "remote": {
            "type": "remote",
            "url": "https://opencode.example/mcp",
            "headers": { "X-Api-Key": "opencode-secret" }
          },
          "off": {
            "type": "local",
            "command": ["off-server"],
            "enabled": false
          }
        }
      }
    }`,
  );
  await writeFileAt(
    join(home, ".pi", "agent", "mcp.json"),
    JSON.stringify({ mcpServers: { "pi-server": { command: "pi-mcp" } } }),
  );
}

describe("scanInstalledMcpServers", () => {
  test("normalizes every supported agent and masks secrets", async () => {
    const home = await createHome();
    await seedAllSources(home);

    const result = await scanInstalledMcpServers({ home, env: {} });

    expect(result.errors).toEqual([]);
    const names = result.servers.map((server) => `${server.source}:${server.name}`);
    expect(names).toEqual([
      "claude:github",
      "claude:local",
      "codex:docs",
      "codex:remote",
      "cursor:playwright",
      "opencode:browse",
      "opencode:off",
      "opencode:remote",
      "pi:pi-server",
    ]);

    const github = result.servers.find((server) => server.name === "github");
    expect(github).toMatchObject({
      transport: "http",
      config: {
        type: "http",
        url: "https://api.githubcopilot.com/mcp/",
        headers: { Authorization: "" },
      },
    });

    const local = result.servers.find((server) => server.name === "local");
    expect(local).toMatchObject({
      transport: "stdio",
      config: {
        type: "stdio",
        command: "node",
        args: ["server.js"],
        env: { TOKEN: "" },
        cwd: "/repo",
      },
    });

    expect(result.servers.find((server) => server.name === "browse")).toMatchObject({
      source: "opencode",
      config: {
        type: "stdio",
        command: "browse",
        args: ["mcp"],
        env: { OPENCODE_BROWSER_RUNTIME: "" },
      },
    });

    expect(
      result.servers.find((server) => server.name === "remote" && server.source === "codex"),
    ).toMatchObject({
      config: {
        type: "http",
        url: "https://codex.example/mcp",
        headers: { Authorization: "" },
      },
      warnings: ["Tool policy from Codex is not imported."],
    });

    expect(result.servers.find((server) => server.name === "off")?.warnings).toEqual([
      "This server is disabled in OpenCode.",
    ]);

    expect(JSON.stringify(result)).not.toContain("claude-secret");
    expect(JSON.stringify(result)).not.toContain("claude-env-secret");
    expect(JSON.stringify(result)).not.toContain("codex-secret");
    expect(JSON.stringify(result)).not.toContain("opencode-secret");
  });

  test("keeps real values for import", async () => {
    const home = await createHome();
    await seedAllSources(home);

    const result = await scanInstalledMcpServers({ home, env: {}, redact: false });
    const local = result.servers.find((server) => server.name === "local");
    expect(local?.config).toMatchObject({ env: { TOKEN: "claude-env-secret" } });
  });

  test("marks servers already configured in Paseo", async () => {
    const home = await createHome();
    await seedAllSources(home);
    const currentServers: Record<string, McpServerConfig> = {
      github: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
    };

    const result = await scanInstalledMcpServers({ home, env: {}, currentServers });
    const github = result.servers.find((server) => server.name === "github");
    const playwright = result.servers.find((server) => server.name === "playwright");
    expect(github?.alreadyConfigured).toBe(true);
    expect(playwright?.alreadyConfigured).toBe(false);
  });

  test("reports unreadable config without dropping other sources", async () => {
    const home = await createHome();
    await writeFileAt(join(home, ".claude.json"), "{ not json");
    await writeFileAt(
      join(home, ".pi", "agent", "mcp.json"),
      JSON.stringify({ mcpServers: { "pi-server": { command: "pi-mcp" } } }),
    );

    const result = await scanInstalledMcpServers({ home, env: {} });
    expect(result.servers.map((server) => server.name)).toEqual(["pi-server"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("claude:");
  });
});
