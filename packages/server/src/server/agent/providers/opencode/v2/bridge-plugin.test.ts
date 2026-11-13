import { describe, expect, test } from "vitest";

import plugin, { budgetToolSurface, scopeCompactionMessages } from "./bridge-plugin.mjs";

const phraseA = "frase só do chat A";
const phraseB = "acesso Tailscale obrigatório";
const historyA = [{ id: "a1", type: "compaction", status: "completed", summary: phraseA }];
const historyB = [{ id: "b1", type: "user", text: phraseB }];

describe("OpenCode compaction scope", () => {
  test("a swapped compaction request is replaced with this session's history", () => {
    const scopedA = scopeCompactionMessages(
      "ses_A",
      [{ id: "b1", type: "user", text: phraseB, sessionID: "ses_B" }],
      historyA,
    );
    expect(JSON.stringify(scopedA)).toContain(phraseA);
    expect(JSON.stringify(scopedA)).not.toContain(phraseB);

    const scopedB = scopeCompactionMessages("ses_B", historyA, historyB);
    expect(JSON.stringify(scopedB)).toContain(phraseB);
    expect(JSON.stringify(scopedB)).not.toContain(phraseA);
    expect(
      scopeCompactionMessages(
        "ses_A",
        [{ id: "b1", type: "user", text: phraseB, sessionID: "ses_B" }],
        historyA,
      ),
    ).toEqual(scopedA);
  });

  test("the compaction hook reads the canonical history for the session being compacted", async () => {
    const hooks = new Map<string, (input: { sessionID: string; messages: unknown[] }) => unknown>();
    const dispose = await plugin.setup({
      options: {},
      tool: {
        transform: async () => ({ dispose: async () => undefined }),
      },
      session: {
        hook: async (
          name: string,
          fn: (input: { sessionID: string; messages: unknown[] }) => unknown,
        ) => {
          hooks.set(name, fn);
          return { dispose: async () => undefined };
        },
        context: async ({ sessionID }: { sessionID: string }) =>
          sessionID === "ses_A" ? historyA : historyB,
        get: async () => {
          throw new Error("unbound");
        },
      },
    });

    const chatA = { sessionID: "ses_A", messages: [{ id: "b1", type: "user", text: phraseB }] };
    await hooks.get("compaction")?.(chatA);
    expect(JSON.stringify(chatA.messages)).toContain(phraseA);
    expect(JSON.stringify(chatA.messages)).not.toContain(phraseB);

    const chatB = {
      sessionID: "ses_B",
      messages: [{ id: "a1", type: "compaction", summary: phraseA }],
    };
    await hooks.get("compaction")?.(chatB);
    expect(JSON.stringify(chatB.messages)).toContain(phraseB);
    expect(JSON.stringify(chatB.messages)).not.toContain(phraseA);

    const again = { sessionID: "ses_A", messages: [{ id: "b1", type: "user", text: phraseB }] };
    await hooks.get("compaction")?.(again);
    expect(again.messages).toEqual(chatA.messages);

    await dispose();
  });
});

describe("OpenCode tool budget", () => {
  function surface(names: string[]): Record<string, unknown> {
    return Object.fromEntries(names.map((name) => [name, { description: name }]));
  }

  test("leaves a request that already fits untouched", () => {
    const tools = surface(["read", "bash", "kabum_search", "kabum_details", "paseo_list_agents"]);

    const result = budgetToolSurface({ tools, maxTools: 128 });

    expect(result.removed).toEqual([]);
    expect(result.hiddenServers).toEqual([]);
    expect(Object.keys(tools)).toHaveLength(5);
  });

  test("does nothing when the model has no known ceiling", () => {
    const tools = surface(["read", "kabum_search", "paseo_list_agents"]);

    const result = budgetToolSurface({ tools, maxTools: undefined });

    expect(result.removed).toEqual([]);
    expect(Object.keys(tools)).toHaveLength(3);
  });

  test("drops the largest MCP surface first and keeps OpenCode builtins", () => {
    const tools = surface([
      "read",
      "bash",
      "kabum_a",
      "kabum_b",
      "kabum_c",
      "hutch_a",
      "hutch_b",
      "shopee_a",
      "paseo_list_agents",
    ]);

    const result = budgetToolSurface({ tools, maxTools: 4 });

    expect(result.hiddenServers).toEqual(["kabum", "hutch"]);
    expect(Object.keys(tools).sort()).toEqual(["bash", "paseo_list_agents", "read", "shopee_a"]);
  });

  test("never drops a server halfway and spares the Paseo catalog until last", () => {
    const tools = surface([
      "read",
      "kabum_search",
      "kabum_details",
      "paseo_list_agents",
      "paseo_create_agent",
      "paseo_list_hosts",
    ]);

    const result = budgetToolSurface({ tools, maxTools: 4 });

    expect(result.hiddenServers).toEqual(["kabum"]);
    expect(result.kept).toBe(4);
    expect(Object.keys(tools).sort()).toEqual([
      "paseo_create_agent",
      "paseo_list_agents",
      "paseo_list_hosts",
      "read",
    ]);
  });

  test("drops the Paseo catalog only when the MCP surfaces are not enough", () => {
    const tools = surface([
      "read",
      "kabum_search",
      "paseo_list_agents",
      "paseo_create_agent",
      "paseo_list_hosts",
    ]);

    const result = budgetToolSurface({ tools, maxTools: 2 });

    expect(result.hiddenServers).toEqual(["kabum", "paseo"]);
    expect(Object.keys(tools)).toEqual(["read"]);
  });

  test("keeps the structured-output tool under any ceiling", () => {
    const tools = surface(["paseo_structured_output", "kabum_search", "hutch_query"]);

    const result = budgetToolSurface({ tools, maxTools: 1 });

    expect(result.removed).toEqual(["hutch_query", "kabum_search"]);
    expect(Object.keys(tools)).toEqual(["paseo_structured_output"]);
  });
});
