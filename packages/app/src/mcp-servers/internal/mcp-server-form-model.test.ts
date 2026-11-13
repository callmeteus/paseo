import { describe, expect, test } from "vitest";
import {
  createKeyValueEntry,
  draftFromPresetVariant,
  fromMcpServerConfig,
  parseArgs,
  toMcpServerConfig,
  type McpServerDraft,
} from "./mcp-server-form-model";
import type { McpServerPresetVariant, PresetField } from "./mcp-server-presets";

const AUTHENTIK_VARIANT: McpServerPresetVariant = {
  id: "full",
  label: "Full access",
  transport: "stdio",
  auth: "token",
  command: "uvx",
  args: ["authentik-mcp", "--base-url", "{{AUTHENTIK_URL}}", "--token", "{{AUTHENTIK_TOKEN}}"],
};

const AUTHENTIK_FIELDS: PresetField[] = [
  {
    key: "AUTHENTIK_URL",
    label: "Authentik URL",
    placeholder: "https://authentik.example.com",
    target: "placeholder",
    required: true,
  },
  {
    key: "AUTHENTIK_TOKEN",
    label: "API token",
    placeholder: "ak-...",
    target: "placeholder",
    required: true,
    secret: true,
  },
];

function draft(overrides: Partial<McpServerDraft>): McpServerDraft {
  return {
    name: "server",
    type: "stdio",
    command: "",
    args: [],
    env: [],
    cwd: "",
    url: "",
    headers: [],
    alwaysLoad: false,
    variables: {},
    ...overrides,
  };
}

describe("fromMcpServerConfig", () => {
  test("keeps stdio command, args, env and cwd", () => {
    const result = fromMcpServerConfig({
      type: "stdio",
      command: "npx",
      args: ["-y", "server"],
      env: { TOKEN: "secret" },
      cwd: "/repo",
      alwaysLoad: true,
    });
    expect(result.type).toBe("stdio");
    expect(result.command).toBe("npx");
    expect(result.args).toEqual(["-y", "server"]);
    expect(result.env.map((entry) => [entry.key, entry.value])).toEqual([["TOKEN", "secret"]]);
    expect(result.cwd).toBe("/repo");
    expect(result.alwaysLoad).toBe(true);
  });

  test("keeps http url and headers", () => {
    const result = fromMcpServerConfig({
      type: "http",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer token" },
    });
    expect(result.type).toBe("http");
    expect(result.url).toBe("https://example.com/mcp");
    expect(result.headers.map((entry) => [entry.key, entry.value])).toEqual([
      ["Authorization", "Bearer token"],
    ]);
  });
});

describe("toMcpServerConfig", () => {
  test("round-trips a stdio server", () => {
    const config = fromMcpServerConfig({
      type: "stdio",
      command: "npx",
      args: ["-y", "server"],
      env: { TOKEN: "secret" },
    });
    const result = toMcpServerConfig({ ...config, name: "my-server" });
    expect(result).toEqual({
      ok: true,
      config: {
        type: "stdio",
        command: "npx",
        args: ["-y", "server"],
        env: { TOKEN: "secret" },
      },
    });
  });

  test("adds preset env values on top of manual entries", () => {
    const fields: PresetField[] = [
      { key: "MYSQL_HOST", label: "Host", placeholder: "", target: "env", required: true },
    ];
    const result = toMcpServerConfig(
      draft({
        command: "uvx",
        env: [createKeyValueEntry("MYSQL_DATABASE", "app")],
        variables: { MYSQL_HOST: "db.internal" },
      }),
      fields,
    );
    expect(result).toEqual({
      ok: true,
      config: {
        type: "stdio",
        command: "uvx",
        env: { MYSQL_HOST: "db.internal", MYSQL_DATABASE: "app" },
      },
    });
  });

  test("substitutes preset placeholders in args", () => {
    const config = draftFromPresetVariant("authentik", AUTHENTIK_VARIANT, AUTHENTIK_FIELDS);
    const result = toMcpServerConfig(
      {
        ...config,
        variables: {
          AUTHENTIK_URL: "https://authentik.example.com",
          AUTHENTIK_TOKEN: "ak-token",
        },
      },
      AUTHENTIK_FIELDS,
    );
    expect(result).toEqual({
      ok: true,
      config: {
        type: "stdio",
        command: "uvx",
        args: [
          "authentik-mcp",
          "--base-url",
          "https://authentik.example.com",
          "--token",
          "ak-token",
        ],
      },
    });
  });

  test("prefills preset defaults", () => {
    const variant: McpServerPresetVariant = {
      id: "stdio",
      label: "Local",
      transport: "stdio",
      auth: "none",
      command: "browse",
      args: ["mcp"],
      fields: [
        {
          key: "OPENCODE_BROWSER_RUNTIME",
          label: "Runtime",
          placeholder: "auto-update",
          target: "env",
          defaultValue: "auto-update",
        },
      ],
    };
    const config = draftFromPresetVariant("browse", variant, variant.fields!);
    expect(config.variables).toEqual({ OPENCODE_BROWSER_RUNTIME: "auto-update" });
    expect(toMcpServerConfig(config, variant.fields!).ok).toBe(true);
  });

  test("reports missing required preset fields", () => {
    const config = draftFromPresetVariant("authentik", AUTHENTIK_VARIANT, AUTHENTIK_FIELDS);
    const result = toMcpServerConfig(config, AUTHENTIK_FIELDS);
    expect(result).toEqual({
      ok: false,
      errors: [
        { field: "AUTHENTIK_URL", code: "fieldRequired" },
        { field: "AUTHENTIK_TOKEN", code: "fieldRequired" },
      ],
    });
  });

  test("requires a name and a valid url", () => {
    const result = toMcpServerConfig({
      ...draft({ name: " ", type: "http", url: "ftp://example.com" }),
    });
    expect(result).toEqual({
      ok: false,
      errors: [
        { field: "name", code: "nameRequired" },
        { field: "url", code: "urlInvalid" },
      ],
    });
  });

  test("rejects a name already in use", () => {
    const result = toMcpServerConfig(
      draft({ name: "github", command: "npx" }),
      [],
      ["github", "local"],
    );
    expect(result).toEqual({
      ok: false,
      errors: [{ field: "name", code: "nameDuplicate" }],
    });
  });
});

describe("parseArgs", () => {
  test("splits on whitespace", () => {
    expect(parseArgs("-y @playwright/mcp@latest")).toEqual(["-y", "@playwright/mcp@latest"]);
  });

  test("keeps quoted segments together", () => {
    expect(parseArgs(`-y "some package" '--flag=value with spaces'`)).toEqual([
      "-y",
      "some package",
      "--flag=value with spaces",
    ]);
  });

  test("ignores a dangling quote", () => {
    expect(parseArgs(`-y "unterminated`)).toEqual(["-y", "unterminated"]);
  });
});
