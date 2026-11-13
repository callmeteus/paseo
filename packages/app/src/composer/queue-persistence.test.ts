import { describe, expect, test } from "vitest";
import type { AgentQueuedMessage } from "@getpaseo/protocol/messages";
import type { AttachmentMetadata, ComposerAttachment } from "@/attachments/types";
import {
  hydrateQueuedMessages,
  persistAgentMessageQueue,
  serializeQueuedMessages,
  type QueueAttachmentPort,
} from "./queue-persistence";
import type { QueuedComposerMessage } from "./actions";

function metadata(id: string, mimeType = "image/png"): AttachmentMetadata {
  return {
    id,
    mimeType,
    storageType: "web-indexeddb",
    storageKey: `key-${id}`,
    fileName: null,
    byteSize: 4,
    createdAt: 1,
  };
}

function queuedItem(): QueuedComposerMessage {
  return {
    id: "message-1",
    text: "hello",
    attachments: [
      { kind: "image", metadata: metadata("image-1") },
      { kind: "quote", text: "quoted" },
      {
        kind: "browser_element",
        attachment: {
          screenshot: metadata("screenshot-1", "image/jpeg"),
        },
      } as unknown as ComposerAttachment,
    ],
  };
}

function port(): QueueAttachmentPort {
  return {
    encodeAttachment: async (attachment) => ({
      data: `base64-${attachment.id}`,
      mimeType: attachment.mimeType,
      fileName: attachment.fileName ?? null,
    }),
    persistImage: async ({ id, mimeType, fileName }) => ({
      ...metadata(id, mimeType),
      storageKey: `restored-${id}`,
      fileName,
    }),
  };
}

describe("serializeQueuedMessages", () => {
  test("keeps composer attachments and encodes every nested image", async () => {
    const serialized = await serializeQueuedMessages([queuedItem()], port());

    expect(serialized).toEqual([
      {
        id: "message-1",
        text: "hello",
        attachments: queuedItem().attachments,
        images: [
          {
            id: "image-1",
            data: "base64-image-1",
            mimeType: "image/png",
            fileName: null,
          },
          {
            id: "screenshot-1",
            data: "base64-screenshot-1",
            mimeType: "image/jpeg",
            fileName: null,
          },
        ],
      },
    ]);
  });

  test("drops an image that cannot be read", async () => {
    const serialized = await serializeQueuedMessages([queuedItem()], {
      ...port(),
      encodeAttachment: async () => null,
    });
    expect(serialized[0]?.images).toEqual([]);
  });
});

describe("hydrateQueuedMessages", () => {
  test("restores image files and remaps their metadata", async () => {
    const stored: AgentQueuedMessage[] = await serializeQueuedMessages([queuedItem()], port());
    const hydrated = await hydrateQueuedMessages(stored, port());

    expect(hydrated[0]?.id).toBe("message-1");
    expect(hydrated[0]?.text).toBe("hello");
    expect(hydrated[0]?.attachments[0]).toMatchObject({
      kind: "image",
      metadata: { id: "image-1", storageKey: "restored-image-1" },
    });
    expect(hydrated[0]?.attachments[2]).toMatchObject({
      kind: "browser_element",
      attachment: { screenshot: { id: "screenshot-1", storageKey: "restored-screenshot-1" } },
    });
  });
});

describe("persistAgentMessageQueue", () => {
  test("sends the text first and then the encoded images", async () => {
    const calls: Array<{ agentId: string; items: AgentQueuedMessage[] }> = [];
    await persistAgentMessageQueue(
      {
        setAgentMessageQueue: async (agentId, items) => {
          calls.push({ agentId, items });
          return items;
        },
      },
      "agent-1",
      [queuedItem()],
      port(),
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]?.agentId).toBe("agent-1");
    expect(calls[0]?.items[0]?.images).toEqual([]);
    expect(calls[1]?.items[0]?.images[0]).toMatchObject({
      id: "image-1",
      data: "base64-image-1",
    });
  });

  test("writes once when the queue has no images", async () => {
    const calls: AgentQueuedMessage[][] = [];
    await persistAgentMessageQueue(
      {
        setAgentMessageQueue: async (_agentId, items) => {
          calls.push(items);
          return items;
        },
      },
      "agent-1",
      [{ id: "message-1", text: "hello", attachments: [] }],
      port(),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]?.images).toEqual([]);
  });
});
