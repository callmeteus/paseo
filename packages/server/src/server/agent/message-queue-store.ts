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
export class MessageQueueStore {
  private readonly directory: string;

  constructor(
    private readonly options: {
      paseoHome: string;
      logger: Logger;
    },
  ) {
    this.directory = path.join(options.paseoHome, "message-queues");
  }

  async get(agentId: string): Promise<AgentQueuedMessage[]> {
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
    if (items.length === 0) {
      await this.delete(agentId);
      return [];
    }
    const parsed = STORED_QUEUE_SCHEMA.parse({ agentId, items });
    await writeJsonFileAtomic(this.pathFor(agentId), parsed);
    return parsed.items;
  }

  async delete(agentId: string): Promise<void> {
    await fs.rm(this.pathFor(agentId), { force: true });
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
