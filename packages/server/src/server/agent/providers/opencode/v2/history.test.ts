import { describe, expect, test } from "vitest";

import type { V2Api } from "./api.js";
import { messages } from "./history.js";

const phraseA = "frase só do chat A";
const phraseB = "acesso Tailscale obrigatório";

describe("OpenCode v2 history", () => {
  test("keeps chat A free of a phrase that exists only on chat B", async () => {
    const client = {
      message: {
        list: async () => ({
          data: [
            { id: "a1", type: "user", time: { created: 1 }, text: phraseA, sessionID: "A" },
            {
              id: "b1",
              type: "compaction",
              status: "completed",
              summary: phraseB,
              sessionID: "B",
              time: { created: 2 },
            },
          ],
          cursor: {},
        }),
      },
    } as unknown as V2Api;

    const chatA = await messages(client, "A");
    const chatB = await messages(client, "B");

    expect(JSON.stringify(chatA)).toContain(phraseA);
    expect(JSON.stringify(chatA)).not.toContain(phraseB);
    expect(JSON.stringify(chatB)).toContain(phraseB);
    expect(JSON.stringify(chatB)).not.toContain(phraseA);
    expect(await messages(client, "A")).toEqual(chatA);
  });
});
