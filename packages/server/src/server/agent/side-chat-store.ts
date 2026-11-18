import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeJsonFileAtomic } from "../atomic-file.js";

const SideChatItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["question", "answer", "error"]),
  text: z.string().optional(),
  message: z.string().optional(),
  createdAt: z.string(),
});

const SideChatFileSchema = z.object({
  agentId: z.string(),
  items: z.array(SideChatItemSchema),
});

export type SideChatItem = z.infer<typeof SideChatItemSchema>;

const writes = new Map<string, Promise<void>>();

function sideChatPath(agentsDir: string, agentId: string): string {
  if (!z.guid().safeParse(agentId).success) {
    throw new Error("Side chat agentId must be a UUID");
  }
  return path.join(path.dirname(agentsDir), "side-chats", `${agentId}.json`);
}

function queue(agentId: string, task: () => Promise<void>): Promise<void> {
  const prev = writes.get(agentId) ?? Promise.resolve();
  const next = prev.then(task, task);
  const tracked = next.finally(() => {
    if (writes.get(agentId) === tracked) writes.delete(agentId);
  });
  writes.set(agentId, tracked);
  return tracked;
}

async function readSideChatFile(agentsDir: string, agentId: string): Promise<SideChatItem[]> {
  const filePath = sideChatPath(agentsDir, agentId);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const parsed = SideChatFileSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data.items : [];
}

export async function readSideChat(agentsDir: string, agentId: string): Promise<SideChatItem[]> {
  await writes.get(agentId);
  return readSideChatFile(agentsDir, agentId);
}

export async function appendSideChat(
  agentsDir: string,
  agentId: string,
  items: Array<Omit<SideChatItem, "id" | "createdAt"> & { id?: string; createdAt?: string }>,
): Promise<SideChatItem[]> {
  const created: SideChatItem[] = [];
  await queue(agentId, async () => {
    const existing = await readSideChatFile(agentsDir, agentId);
    const now = new Date().toISOString();
    for (const item of items) {
      created.push({
        ...item,
        id: item.id ?? randomUUID(),
        createdAt: item.createdAt ?? now,
      });
    }
    await writeJsonFileAtomic(sideChatPath(agentsDir, agentId), {
      agentId,
      items: [...existing, ...created],
    });
  });
  return created;
}

export async function clearSideChat(agentsDir: string, agentId: string): Promise<void> {
  await queue(agentId, async () => {
    await fs.rm(sideChatPath(agentsDir, agentId), { force: true });
  });
}

export async function deleteSideChat(agentsDir: string, agentId: string): Promise<void> {
  await clearSideChat(agentsDir, agentId);
}
