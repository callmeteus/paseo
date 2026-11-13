import type { AgentQueuedMessage, AgentQueuedMessageImage } from "@getpaseo/protocol/messages";
import type { AttachmentMetadata, ComposerAttachment } from "@/attachments/types";
import { persistAttachmentFromDataUrl } from "@/attachments/service";
import { getAttachmentStore } from "@/attachments/store";
import type { QueuedComposerMessage } from "./actions";

export interface MessageQueuePersistenceClient {
  setAgentMessageQueue(
    agentId: string,
    items: AgentQueuedMessage[],
    requestId?: string,
  ): Promise<AgentQueuedMessage[]>;
}

export interface QueueAttachmentPort {
  encodeAttachment: (
    attachment: AttachmentMetadata,
  ) => Promise<{ data: string; mimeType: string; fileName: string | null } | null>;
  persistImage: (input: {
    id: string;
    mimeType: string;
    fileName: string | null;
    data: string;
  }) => Promise<AttachmentMetadata>;
}

const defaultPort: QueueAttachmentPort = {
  encodeAttachment: async (attachment) => {
    try {
      const store = await getAttachmentStore();
      const data = await store.encodeBase64({ attachment });
      return {
        data,
        mimeType: attachment.mimeType,
        fileName: attachment.fileName ?? null,
      };
    } catch (error) {
      console.warn("[message-queue] Failed to encode attachment", {
        id: attachment.id,
        error,
      });
      return null;
    }
  },
  persistImage: async ({ id, mimeType, fileName, data }) =>
    await persistAttachmentFromDataUrl({
      id,
      mimeType,
      fileName,
      dataUrl: `data:${mimeType};base64,${data}`,
    }),
};

export async function serializeQueuedMessages(
  items: readonly QueuedComposerMessage[],
  port: QueueAttachmentPort = defaultPort,
): Promise<AgentQueuedMessage[]> {
  return await Promise.all(
    items.map(async (item) => {
      const metadata = collectAttachmentMetadata(item.attachments).filter((attachment) =>
        attachment.mimeType.startsWith("image/"),
      );
      const encoded = await Promise.all(
        metadata.map(async (attachment) => {
          const data = await port.encodeAttachment(attachment);
          return data
            ? {
                id: attachment.id,
                data: data.data,
                mimeType: data.mimeType,
                fileName: data.fileName,
              }
            : null;
        }),
      );
      const images: AgentQueuedMessageImage[] = encoded.filter(
        (entry): entry is NonNullable<typeof entry> => entry !== null,
      );
      return {
        id: item.id,
        text: item.text,
        attachments: item.attachments as unknown[],
        images,
      };
    }),
  );
}

export async function hydrateQueuedMessages(
  items: readonly AgentQueuedMessage[],
  port: QueueAttachmentPort = defaultPort,
): Promise<QueuedComposerMessage[]> {
  return await Promise.all(
    items.map(async (item) => {
      const remapped = new Map<string, AttachmentMetadata>();
      for (const image of item.images) {
        try {
          remapped.set(
            image.id,
            await port.persistImage({
              id: image.id,
              mimeType: image.mimeType,
              fileName: image.fileName ?? null,
              data: image.data,
            }),
          );
        } catch (error) {
          console.warn("[message-queue] Failed to restore queued image", {
            id: image.id,
            error,
          });
        }
      }
      return {
        id: item.id,
        text: item.text,
        attachments: remapAttachmentMetadata(item.attachments, remapped) as ComposerAttachment[],
      };
    }),
  );
}

const clientTails = new WeakMap<object, Map<string, Promise<void>>>();

export function persistAgentMessageQueue(
  client: MessageQueuePersistenceClient,
  agentId: string,
  items: readonly QueuedComposerMessage[],
  port: QueueAttachmentPort = defaultPort,
): Promise<void> {
  let tails = clientTails.get(client);
  if (!tails) {
    tails = new Map();
    clientTails.set(client, tails);
  }
  const previous = tails.get(agentId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => writeQueue(client, agentId, items, port));
  tails.set(agentId, next);
  void next
    .catch(() => undefined)
    .finally(() => {
      if (tails?.get(agentId) === next) tails.delete(agentId);
    });
  return next;
}

async function writeQueue(
  client: MessageQueuePersistenceClient,
  agentId: string,
  items: readonly QueuedComposerMessage[],
  port: QueueAttachmentPort,
): Promise<void> {
  // Persist the queue before reading image bytes, so an immediate refresh keeps
  // the text and attachment metadata even when image encoding is slow.
  const quick: AgentQueuedMessage[] = items.map((item) => ({
    id: item.id,
    text: item.text,
    attachments: item.attachments as unknown[],
    images: [],
  }));
  await client.setAgentMessageQueue(agentId, quick);
  const hasImages = items.some((item) =>
    collectAttachmentMetadata(item.attachments).some((attachment) =>
      attachment.mimeType.startsWith("image/"),
    ),
  );
  if (!hasImages) return;
  await client.setAgentMessageQueue(agentId, await serializeQueuedMessages(items, port));
}

function collectAttachmentMetadata(
  value: unknown,
  result: AttachmentMetadata[] = [],
): AttachmentMetadata[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectAttachmentMetadata(entry, result);
    return result;
  }
  if (!value || typeof value !== "object") return result;
  const record = value as Record<string, unknown>;
  if (isAttachmentMetadata(record)) {
    result.push(record);
    return result;
  }
  for (const entry of Object.values(record)) {
    collectAttachmentMetadata(entry, result);
  }
  return result;
}

function isAttachmentMetadata(value: unknown): value is AttachmentMetadata {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.mimeType === "string" &&
    typeof record.storageType === "string" &&
    typeof record.storageKey === "string"
  );
}

function remapAttachmentMetadata(
  value: unknown,
  remapped: ReadonlyMap<string, AttachmentMetadata>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => remapAttachmentMetadata(entry, remapped));
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (isAttachmentMetadata(record)) {
    return remapped.get(record.id) ?? record;
  }
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    next[key] = remapAttachmentMetadata(entry, remapped);
  }
  return next;
}
