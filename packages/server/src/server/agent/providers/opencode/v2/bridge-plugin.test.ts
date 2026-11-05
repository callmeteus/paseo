import { describe, expect, test } from "vitest";

import plugin, { scopeCompactionMessages } from "./bridge-plugin.mjs";

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
