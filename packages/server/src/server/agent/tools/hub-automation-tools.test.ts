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
  });
});

function handler(
  name: string,
  hubAutomations: () => {
    origin: string;
    daemonId: string;
    credential: string;
  } | null,
): (input: { yaml?: string }) => Promise<PaseoToolResult> {
  let found: ((input: { yaml?: string }) => Promise<PaseoToolResult>) | undefined;
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
