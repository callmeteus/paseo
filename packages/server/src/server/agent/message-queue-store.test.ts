import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { Logger } from "pino";
import type { AgentQueuedMessage } from "@getpaseo/protocol/messages";
import { MessageQueueStore } from "./message-queue-store.js";

const homes: string[] = [];
const logger = { warn: () => undefined } as unknown as Logger;

async function createStore(): Promise<{ home: string; store: MessageQueueStore }> {
  const home = await mkdtemp(join(tmpdir(), "paseo-message-queue-"));
  homes.push(home);
  return { home, store: new MessageQueueStore({ paseoHome: home, logger }) };
}

function queuedMessage(id: string): AgentQueuedMessage {
  return {
    id,
    text: `message ${id}`,
    attachments: [{ kind: "quote", text: "quoted" }],
    images: [{ id: `image-${id}`, mimeType: "image/png", data: "aGVsbG8=" }],
  };
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("MessageQueueStore", () => {
  test("persists a queue and reads it back", async () => {
    const { home, store } = await createStore();

    await expect(
      store.set("agent-1", [queuedMessage("one"), queuedMessage("two")]),
    ).resolves.toEqual([queuedMessage("one"), queuedMessage("two")]);
    await expect(
      new MessageQueueStore({ paseoHome: home, logger }).get("agent-1"),
    ).resolves.toEqual([queuedMessage("one"), queuedMessage("two")]);
  });

  test("lists every persisted queue", async () => {
    const { store } = await createStore();
    await store.set("agent-1", [queuedMessage("one")]);
    await store.set("agent-2", [queuedMessage("two")]);

    await expect(store.list()).resolves.toEqual({
      "agent-1": [queuedMessage("one")],
      "agent-2": [queuedMessage("two")],
    });
  });

  test("clears an agent queue when the list is empty", async () => {
    const { store } = await createStore();
    await store.set("agent-1", [queuedMessage("one")]);

    await expect(store.set("agent-1", [])).resolves.toEqual([]);
    await expect(store.get("agent-1")).resolves.toEqual([]);
    await expect(store.list()).resolves.toEqual({});
  });

  test("ignores invalid files instead of dropping every queue", async () => {
    const { home, store } = await createStore();
    await store.set("agent-1", [queuedMessage("one")]);
    await writeFile(join(home, "message-queues", "broken.json"), "{ not json", "utf8");

    await expect(store.list()).resolves.toEqual({ "agent-1": [queuedMessage("one")] });
  });
});
