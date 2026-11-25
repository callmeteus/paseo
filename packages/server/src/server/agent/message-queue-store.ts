import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Logger } from "pino";
import { AgentQueuedMessageSchema } from "@getpaseo/protocol/messages";
import type { AgentQueuedMessage } from "@getpaseo/protocol/messages";
import { writeJsonFileAtomic } from "../atomic-file.js";

const STORED_QUEUE_SCHEMA = z.object({
  agentId: z.string().min(1),
  items: z.array(AgentQueuedMessageSchema),
});

/**
 * Host-side persistence for composer queues. Attachments and image bytes live
 * in the item payload so a fresh client can restore the queue unchanged.
 */
export interface MessageQueueChange {
  agentId: string;
  items: AgentQueuedMessage[];
}

type MessageQueueListener = (change: MessageQueueChange) => void;

export class MessageQueueStore {
  private readonly directory: string;
  private readonly listeners = new Set<MessageQueueListener>();
  private readonly tails = new Map<string, Promise<void>>();

  constructor(
    private readonly options: {
      paseoHome: string;
      logger: Logger;
    },
  ) {
    this.directory = path.join(options.paseoHome, "message-queues");
  }

  /**
   * Observe persisted queue changes. The store is shared by every session, so
   * this is the daemon-wide fan-out point for queue synchronisation.
   */
  public subscribe(listener: MessageQueueListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async get(agentId: string): Promise<AgentQueuedMessage[]> {
    return this.getUnlocked(agentId);
  }

  async list(): Promise<Record<string, AgentQueuedMessage[]>> {
    let entries;
    try {
      entries = await fs.readdir(this.directory, { withFileTypes: true });
    } catch (error) {
      if (isMissingFile(error)) return {};
      throw error;
    }
    const queues: Record<string, AgentQueuedMessage[]> = {};
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const filePath = path.join(this.directory, entry.name);
      try {
        const parsed = STORED_QUEUE_SCHEMA.safeParse(
          JSON.parse(await fs.readFile(filePath, "utf8")),
        );
        if (!parsed.success) {
          this.options.logger.warn(
            { filePath, error: parsed.error.message },
            "Ignoring invalid message queue file",
          );
          continue;
        }
        queues[parsed.data.agentId] = parsed.data.items;
      } catch (error) {
        this.options.logger.warn({ err: error, filePath }, "Failed to read message queue file");
      }
    }
    return queues;
  }

  async set(agentId: string, items: readonly AgentQueuedMessage[]): Promise<AgentQueuedMessage[]> {
    return this.enqueue(agentId, () => this.setUnlocked(agentId, items));
  }

  /** Remove accepted message ids without letting a concurrent snapshot write them back. */
  async remove(agentId: string, messageIds: readonly string[]): Promise<AgentQueuedMessage[]> {
    const removed = new Set(messageIds);
    if (removed.size === 0) return this.get(agentId);
    return this.enqueue(agentId, async () => {
      const current = await this.getUnlocked(agentId);
      const next = current.filter((item) => !removed.has(item.id));
      if (next.length === current.length) return current;
      return this.setUnlocked(agentId, next);
    });
  }

  async delete(agentId: string): Promise<void> {
    await this.enqueue(agentId, async () => {
      await fs.rm(this.pathFor(agentId), { force: true });
      this.notify({ agentId, items: [] });
    });
  }

  private enqueue<T>(agentId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(agentId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(agentId, settled);
    void settled
      .finally(() => {
        if (this.tails.get(agentId) === settled) this.tails.delete(agentId);
      })
      .catch(() => undefined);
    return next;
  }

  private async setUnlocked(
    agentId: string,
    items: readonly AgentQueuedMessage[],
  ): Promise<AgentQueuedMessage[]> {
    if (items.length === 0) {
      await fs.rm(this.pathFor(agentId), { force: true });
      this.notify({ agentId, items: [] });
      return [];
    }
    const parsed = STORED_QUEUE_SCHEMA.parse({ agentId, items });
    await writeJsonFileAtomic(this.pathFor(agentId), parsed);
    this.notify({ agentId, items: parsed.items });
    return parsed.items;
  }

  private async getUnlocked(agentId: string): Promise<AgentQueuedMessage[]> {
    try {
      const text = await fs.readFile(this.pathFor(agentId), "utf8");
      const parsed = STORED_QUEUE_SCHEMA.safeParse(JSON.parse(text));
      if (!parsed.success) {
        this.options.logger.warn(
          { agentId, error: parsed.error.message },
          "Ignoring invalid message queue file",
        );
        return [];
      }
      return parsed.data.items;
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  private notify(change: MessageQueueChange): void {
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (error) {
        this.options.logger.warn({ err: error, agentId: change.agentId }, "Queue listener failed");
      }
    }
  }

  private pathFor(agentId: string): string {
    return path.join(this.directory, `${Buffer.from(agentId).toString("base64url")}.json`);
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
