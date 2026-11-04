import { describe, expect, it } from "vitest";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { createPaseoToolCatalog } from "./paseo-tools.js";
import { registerHubAutomationTools } from "./hub-automation-tools.js";
import { PaseoToolInputError, type PaseoToolResult } from "./types.js";

describe("Hub automation tools", () => {
  it("refuses to list automations when no Hub is connected", async () => {
    const list = handler("list_automations", () => null);
    await expect(list({})).rejects.toBeInstanceOf(PaseoToolInputError);
  });

  it("saves the YAML the chat provides", async () => {
    let saved = "";
    const save = handler("save_automation", () => ({
      origin: "http://127.0.0.1:25000",
      daemonId: "daemon-1",
      credential: "secret",
    }));
    const original = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      if (typeof init?.body !== "string") {
        throw new Error("expected a JSON body");
      }
      const body = JSON.parse(init.body) as { yaml: string };
      saved = body.yaml;
      return Response.json(
        {
          triggerId: "11111111-1111-4111-8111-111111111111",
          name: "channel",
          revisionId: "22222222-2222-4222-8222-222222222222",
          version: 1,
          active: true,
        },
        { status: 201 },
      );
    };
    try {
      const result = await save({ yaml: "name: channel\n" });
      expect(saved).toBe("name: channel");
      expect(result.structuredContent).toMatchObject({ name: "channel", active: true });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("registers the chat tools on the agent catalog", () => {
    const catalog = createPaseoToolCatalog({
      logger: createTestLogger(),
      hubAutomations: () => null,
    });
    expect(catalog.getTool("list_automations")?.title).toBe("List automations");
    expect(catalog.getTool("save_automation")?.title).toBe("Save automation");
    expect(catalog.getTool("list_slack_channels")?.title).toBe("List Slack channels");
    expect(catalog.getTool("read_slack_messages")?.title).toBe("Read Slack messages");
  });

  it("refuses to read Slack when no Hub is connected", async () => {
    const read = handler("read_slack_messages", () => null);
    await expect(read({ channel: "tecnologia-triagem" })).rejects.toBeInstanceOf(
      PaseoToolInputError,
    );
  });

  it("returns the channel id Hub resolved", async () => {
    const list = handler("list_slack_channels", () => ({
      origin: "http://127.0.0.1:25000",
      daemonId: "daemon-1",
      credential: "secret",
    }));
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      expect(requestUrl(input)).toBe(
        "http://127.0.0.1:25000/api/v1/slack/channels?query=tecnologia-triagem-teste",
      );
      return Response.json({
        connection: "acme",
        truncated: false,
        channels: [{ id: "C01234567", name: "tecnologia-triagem-teste", isPrivate: false }],
      });
    };
    try {
      const result = await list({ query: "tecnologia-triagem-teste" });
      expect(result.structuredContent).toMatchObject({
        connection: "acme",
        channels: [{ id: "C01234567", name: "tecnologia-triagem-teste" }],
      });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("surfaces Hub's refusal when the channel cannot be read", async () => {
    const read = handler("read_slack_messages", () => ({
      origin: "http://127.0.0.1:25000",
      daemonId: "daemon-1",
      credential: "secret",
    }));
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      Response.json(
        { title: "Slack channel not found", detail: "No Slack channel matches that name." },
        { status: 404 },
      );
    try {
      await expect(read({ channel: "missing" })).rejects.toMatchObject({
        message: "No Slack channel matches that name.",
      });
    } finally {
      globalThis.fetch = original;
    }
  });
});

interface ToolInput {
  yaml?: string;
  connection?: string;
  query?: string;
  channel?: string;
  limit?: number;
}

function handler(
  name: string,
  hubAutomations: () => {
    origin: string;
    daemonId: string;
    credential: string;
  } | null,
): (input: ToolInput) => Promise<PaseoToolResult> {
  let found: ((input: ToolInput) => Promise<PaseoToolResult>) | undefined;
  registerHubAutomationTools({
    hubAutomations,
    registerTool: (toolName, _config, toolHandler) => {
      if (toolName === name) {
        found = toolHandler;
      }
    },
  });
  if (found === undefined) {
    throw new Error(`missing tool ${name}`);
  }
  return found;
}

/**
 * @param input - Fetch target the tool built
 * @returns The URL string
 */
function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) {
    return input.href;
  }
  if (input instanceof Request) {
    return input.url;
  }
  return input;
}
