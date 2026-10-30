import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import {
  IMPORT_MODEL_LABEL,
  IMPORT_SOURCE_ID_LABEL,
  IMPORT_SOURCE_LABEL,
  PARENT_AGENT_ID_LABEL,
} from "@getpaseo/protocol/agent-labels";

import type { AgentStorage, StoredAgentRecord } from "../../agent/agent-storage.js";
import type { AgentTimelineRow } from "../../agent/agent-timeline-store-types.js";
import type { WorkspaceProvisioningService } from "../../session/workspace-provisioning/workspace-provisioning-service.js";
import type { PersistedWorkspaceRecord } from "../../workspace-registry.js";
import { suggestContinuationProvider } from "./model-map.js";
import { listCursorChats, listCursorSubagentLinks, readCursorChat } from "./reader.js";
import { openCursorStateDb, resolveCursorStateDbPath } from "./state-db.js";
import type { CursorSqliteDatabase } from "./state-db.js";
import { cursorChatToTimeline } from "./timeline.js";
import type { CursorChat } from "./types.js";

export const CURSOR_IMPORT_SOURCE = "cursor";
export const CURSOR_IMPORT_PROVIDER = "cursor";
const MAX_TITLE_CHARS = 80;

export interface ImportCursorChatsInput {
  agentStorage: Pick<AgentStorage, "list" | "upsert">;
  workspaceProvisioning: Pick<WorkspaceProvisioningService, "createWorkspaceForDirectory">;
  logger: Logger;
  /** Explicit selection. Omit to import every chat that matches the filters. */
  composerIds?: readonly string[];
  includeSubagents?: boolean;
  includeArchived?: boolean;
  since?: Date | null;
  cwd?: string | null;
  limit?: number;
  dbPath?: string;
  now?: Date;
  idFactory?: () => string;
}

export type ImportedCursorChatStatus = "imported" | "already_imported" | "skipped";

export interface ImportedCursorChat {
  composerId: string;
  agentId: string | null;
  title: string | null;
  cwd: string | null;
  messageCount: number;
  /** Providers that could continue this chat, best first. Empty for Cursor-only models. */
  suggestedProviders: string[];
  status: ImportedCursorChatStatus;
  error: string | null;
}

export interface ImportCursorChatsResult {
  chats: ImportedCursorChat[];
  importedCount: number;
  alreadyImportedCount: number;
  skippedCount: number;
  /** Workspaces this run had to create so the imported chats have a home. */
  createdWorkspaces: PersistedWorkspaceRecord[];
}

export function isCursorImportedRecord(record: Pick<StoredAgentRecord, "labels">): boolean {
  return record.labels?.[IMPORT_SOURCE_LABEL] === CURSOR_IMPORT_SOURCE;
}

/**
 * Import Cursor IDE chats as durable, read-only Paseo agents.
 *
 * The imported record carries the transcript as `portedTimeline` and has no
 * persistence handle, so the daemon can serve it without spawning a provider.
 * Cursor's database is opened read-only; nothing is written back.
 */
export async function importCursorChats(
  input: ImportCursorChatsInput,
): Promise<ImportCursorChatsResult> {
  const now = input.now ?? new Date();
  const createId = input.idFactory ?? randomUUID;
  const db = openCursorStateDb(input.dbPath ?? resolveCursorStateDbPath());

  try {
    const chats = selectChats(db, input);
    const existing = await collectExistingImports(input.agentStorage);
    const results = new Map<string, ImportedCursorChat>();
    const agentIdByComposer = new Map<string, string>();
    const workspaceByComposer = new Map<string, string>();
    const createdWorkspaces: PersistedWorkspaceRecord[] = [];

    for (const chat of sortParentsFirst(chats)) {
      if (!chat.cwd) {
        results.set(chat.composerId, skipped(chat, "Chat has no workspace folder in Cursor"));
        continue;
      }

      const existingImport = existing.get(chat.composerId);
      if (existingImport) {
        agentIdByComposer.set(chat.composerId, existingImport.agentId);
        if (existingImport.workspaceId) {
          workspaceByComposer.set(chat.composerId, existingImport.workspaceId);
        }
        results.set(chat.composerId, {
          ...imported(chat, existingImport.agentId),
          status: "already_imported",
        });
        continue;
      }

      try {
        const timeline = cursorChatToTimeline(chat);
        if (timeline.length === 0) {
          results.set(chat.composerId, skipped(chat, "Chat has no importable messages"));
          continue;
        }
        const parent = resolveParentImport({
          parentComposerId: chat.parentComposerId,
          existing,
          agentIdByComposer,
          workspaceByComposer,
        });

        // Every imported root chat gets its own workspace under the project,
        // titled with the chat. Subagents share their parent's workspace so
        // they stay in the parent's subagent track instead of the sidebar.
        let workspaceId = parent.workspaceId;
        if (!workspaceId) {
          const workspace = await input.workspaceProvisioning.createWorkspaceForDirectory(
            chat.cwd,
            resolveTitle(chat),
            undefined,
            { expectsInitialAgent: true },
          );
          workspaceId = workspace.workspaceId;
          createdWorkspaces.push(workspace);
        }

        const agentId = createId();
        const record = buildRecord({
          chat,
          agentId,
          workspaceId,
          timeline,
          parentAgentId: parent.agentId,
          now,
        });
        await input.agentStorage.upsert(record);
        agentIdByComposer.set(chat.composerId, agentId);
        workspaceByComposer.set(chat.composerId, workspaceId);
        results.set(chat.composerId, imported(chat, agentId));
      } catch (error) {
        input.logger.warn(
          { err: error, composerId: chat.composerId },
          "Failed to import Cursor chat",
        );
        results.set(
          chat.composerId,
          skipped(chat, error instanceof Error ? error.message : String(error)),
        );
      }
    }

    const ordered = chats.map(
      (chat) => results.get(chat.composerId) ?? skipped(chat, "Chat was not processed"),
    );
    return {
      chats: ordered,
      importedCount: ordered.filter((entry) => entry.status === "imported").length,
      alreadyImportedCount: ordered.filter((entry) => entry.status === "already_imported").length,
      skippedCount: ordered.filter((entry) => entry.status === "skipped").length,
      createdWorkspaces,
    };
  } finally {
    db.close();
  }
}

function selectChats(db: CursorSqliteDatabase, input: ImportCursorChatsInput): CursorChat[] {
  if (input.composerIds?.length) {
    const chats = input.composerIds.map((composerId) => readCursorChat(db, composerId));
    return input.includeSubagents ? expandWithSubagents(db, chats) : chats;
  }
  const summaries = listCursorChats(db, {
    includeSubagents: input.includeSubagents,
    includeArchived: input.includeArchived,
    since: input.since ?? null,
    limit: input.limit ?? 500,
  }).filter((summary) => (input.cwd ? summary.cwd === input.cwd : true));
  const chats = summaries.map((summary) => readCursorChat(db, summary.composerId));
  return input.includeSubagents ? expandWithSubagents(db, chats) : chats;
}

function expandWithSubagents(db: CursorSqliteDatabase, chats: CursorChat[]): CursorChat[] {
  const links = listCursorSubagentLinks(db);
  const selected = new Map(chats.map((chat) => [chat.composerId, chat]));
  const queue = [...chats];
  while (queue.length > 0) {
    const parent = queue.shift() as CursorChat;
    for (const childId of links.get(parent.composerId) ?? []) {
      if (selected.has(childId)) {
        continue;
      }
      try {
        const child = readCursorChat(db, childId);
        selected.set(childId, child);
        queue.push(child);
      } catch {
        // A child whose transcript cannot be read must not fail its parent.
      }
    }
  }
  return [...selected.values()];
}

function sortParentsFirst(chats: CursorChat[]): CursorChat[] {
  return [...chats].sort((a, b) => {
    const aRank = a.parentComposerId ? 1 : 0;
    const bRank = b.parentComposerId ? 1 : 0;
    return aRank - bRank;
  });
}

interface ExistingCursorImport {
  agentId: string;
  workspaceId: string | null;
}

function resolveParentImport(input: {
  parentComposerId: string | null;
  existing: Map<string, ExistingCursorImport>;
  agentIdByComposer: Map<string, string>;
  workspaceByComposer: Map<string, string>;
}): { agentId: string | null; workspaceId: string | null } {
  const parentComposerId = input.parentComposerId;
  if (!parentComposerId) {
    return { agentId: null, workspaceId: null };
  }
  const existing = input.existing.get(parentComposerId);
  return {
    agentId: input.agentIdByComposer.get(parentComposerId) ?? existing?.agentId ?? null,
    workspaceId: input.workspaceByComposer.get(parentComposerId) ?? existing?.workspaceId ?? null,
  };
}

async function collectExistingImports(
  agentStorage: Pick<AgentStorage, "list">,
): Promise<Map<string, ExistingCursorImport>> {
  const existing = new Map<string, ExistingCursorImport>();
  for (const record of await agentStorage.list()) {
    if (!isCursorImportedRecord(record)) {
      continue;
    }
    const sourceId = record.labels?.[IMPORT_SOURCE_ID_LABEL];
    if (sourceId) {
      existing.set(sourceId, {
        agentId: record.id,
        workspaceId: record.workspaceId ?? null,
      });
    }
  }
  return existing;
}

function buildRecord(input: {
  chat: CursorChat;
  agentId: string;
  workspaceId: string;
  timeline: ReturnType<typeof cursorChatToTimeline>;
  parentAgentId: string | null;
  now: Date;
}): StoredAgentRecord {
  const { chat, timeline } = input;
  const rows: AgentTimelineRow[] = timeline.map((entry, index) => ({
    seq: index + 1,
    timestamp: entry.timestamp ?? chat.lastUpdatedAt,
    item: entry.item,
  }));
  const lastUserMessage = chat.messages.findLast(
    (message) => message.role === "user" && message.text.length > 0,
  );
  const labels: Record<string, string> = {
    [IMPORT_SOURCE_LABEL]: CURSOR_IMPORT_SOURCE,
    [IMPORT_SOURCE_ID_LABEL]: chat.composerId,
    ...(chat.modelName ? { [IMPORT_MODEL_LABEL]: chat.modelName } : {}),
    ...(input.parentAgentId ? { [PARENT_AGENT_ID_LABEL]: input.parentAgentId } : {}),
  };

  return {
    id: input.agentId,
    provider: CURSOR_IMPORT_PROVIDER,
    cwd: chat.cwd as string,
    workspaceId: input.workspaceId,
    createdAt: chat.createdAt,
    updatedAt: chat.lastUpdatedAt,
    lastActivityAt: chat.lastUpdatedAt,
    lastUserMessageAt: lastUserMessage?.createdAt || chat.lastUpdatedAt,
    title: resolveTitle(chat),
    labels,
    lastStatus: "closed",
    lastModeId: null,
    config: chat.modelName ? { model: chat.modelName } : null,
    runtimeInfo: {
      provider: CURSOR_IMPORT_PROVIDER,
      sessionId: null,
      model: chat.modelName,
    },
    persistence: null,
    lastError: null,
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: null,
    portedTimeline: rows.map((row) => ({
      seq: row.seq,
      timestamp: row.timestamp,
      item: row.item as Record<string, unknown>,
    })),
  };
}

function resolveTitle(chat: CursorChat): string | null {
  const firstUserText = chat.messages.find(
    (message) => message.role === "user" && message.text.trim().length > 0,
  )?.text;
  const raw =
    chat.title?.trim() ||
    firstUserText?.trim() ||
    (chat.subagentTypeName ? `${chat.subagentTypeName} (Cursor)` : null);
  if (!raw) {
    return null;
  }
  return raw.replace(/\s+/g, " ").slice(0, MAX_TITLE_CHARS).trim();
}

function imported(chat: CursorChat, agentId: string): ImportedCursorChat {
  return {
    composerId: chat.composerId,
    agentId,
    title: resolveTitle(chat),
    cwd: chat.cwd,
    messageCount: chat.messages.length,
    suggestedProviders: [...suggestContinuationProvider(chat.modelName).preferredProviders],
    status: "imported",
    error: null,
  };
}

function skipped(chat: CursorChat, reason: string): ImportedCursorChat {
  return {
    composerId: chat.composerId,
    agentId: null,
    title: resolveTitle(chat),
    cwd: chat.cwd,
    messageCount: chat.messages.length,
    suggestedProviders: [...suggestContinuationProvider(chat.modelName).preferredProviders],
    status: "skipped",
    error: reason,
  };
}
