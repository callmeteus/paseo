import { z } from "zod";

import type { CursorSqliteDatabase } from "./state-db.js";
import { CursorImportError } from "./types.js";
import type {
  CursorChat,
  CursorChatMessage,
  CursorChatRole,
  CursorChatSummary,
  CursorToolCall,
} from "./types.js";

const MAX_MESSAGE_CHARS = 12_000;
const MAX_THINKING_CHARS = 4_000;
const MAX_TOOL_RESULT_CHARS = 4_000;
const COMPOSER_ID_PATTERN = /^[A-Za-z0-9-]+$/;

const composerHeaderValueSchema = z
  .object({
    name: z.string().nullable().optional(),
    subtitle: z.string().nullable().optional(),
    createdAt: z.number().optional(),
    lastUpdatedAt: z.number().optional(),
    workspaceIdentifier: z
      .object({
        uri: z.object({ fsPath: z.string().optional() }).optional(),
      })
      .optional(),
  })
  .passthrough();

const conversationHeaderSchema = z.object({
  bubbleId: z.string(),
  type: z.number().int().optional(),
  createdAt: z.string().optional(),
});

const composerDataSchema = z
  .object({
    composerId: z.string().optional(),
    name: z.string().nullable().optional(),
    createdAt: z.number().optional(),
    lastUpdatedAt: z.number().optional(),
    status: z.string().optional(),
    modelConfig: z
      .object({
        modelName: z.string().optional(),
      })
      .optional(),
    workspaceIdentifier: z
      .object({
        uri: z.object({ fsPath: z.string().optional() }).optional(),
      })
      .optional(),
    fullConversationHeadersOnly: z.array(conversationHeaderSchema).optional(),
    subagentInfo: z
      .object({
        parentComposerId: z.string().optional(),
        subagentType: z.number().optional(),
        subagentTypeName: z.string().optional(),
        toolCallId: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

const bubbleSchema = z
  .object({
    type: z.number().int(),
    bubbleId: z.string().optional(),
    text: z.string().optional(),
    createdAt: z.string().optional(),
    modelInfo: z.object({ modelName: z.string().optional() }).optional(),
    thinking: z.object({ text: z.string().optional() }).optional(),
    toolFormerData: z
      .object({
        toolCallId: z.string().optional(),
        name: z.string().optional(),
        status: z.string().optional(),
        params: z.string().optional(),
        result: z.unknown().optional(),
      })
      .optional(),
  })
  .passthrough();

interface HeaderRow {
  composerId: string;
  createdAt: number | null;
  lastUpdatedAt: number | null;
  isArchived: number | null;
  isSubagent: number | null;
  subagentTypeName: string | null;
  value: string;
}

const headerRowSchema = z.object({
  composerId: z.string(),
  createdAt: z.number().nullable(),
  lastUpdatedAt: z.number().nullable(),
  isArchived: z.number().nullable(),
  isSubagent: z.number().nullable(),
  subagentTypeName: z.string().nullable(),
  value: z.string(),
});

export interface ListCursorChatsOptions {
  includeSubagents?: boolean;
  includeArchived?: boolean;
  query?: string;
  since?: Date | null;
  limit?: number;
}

function toIso(value: number | null | undefined, fallback: string): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function parseHeaderRow(value: unknown): HeaderRow | null {
  const parsed = headerRowSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseHeaderValue(raw: string) {
  try {
    return composerHeaderValueSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function workspacePathFromUri(
  workspaceIdentifier: z.infer<typeof composerDataSchema>["workspaceIdentifier"],
): string | null {
  const fsPath = workspaceIdentifier?.uri?.fsPath?.trim();
  return fsPath ? fsPath : null;
}

function queryHeaderRows(db: CursorSqliteDatabase): HeaderRow[] {
  const rows = db
    .prepare(
      "SELECT composerId, createdAt, lastUpdatedAt, isArchived, isSubagent, subagentTypeName, value FROM composerHeaders",
    )
    .all();
  return rows.flatMap((row) => {
    const parsed = parseHeaderRow(row);
    return parsed ? [parsed] : [];
  });
}

interface SummaryFilters {
  includeArchived: boolean;
  includeSubagents: boolean;
  query: string;
  sinceMs: number | null;
}

function resolveSummaryTimestamps(
  row: HeaderRow,
  head: ReturnType<typeof parseHeaderValue>,
): { createdAt: string; lastUpdatedAt: string } {
  const createdAt = toIso(
    row.createdAt ?? head?.createdAt,
    toIso(row.lastUpdatedAt ?? head?.lastUpdatedAt, new Date(0).toISOString()),
  );
  return {
    createdAt,
    lastUpdatedAt: toIso(row.lastUpdatedAt ?? head?.lastUpdatedAt, createdAt),
  };
}

function isOlderThan(lastUpdatedAt: string, sinceMs: number | null): boolean {
  if (sinceMs === null) {
    return false;
  }
  const updatedMs = Date.parse(lastUpdatedAt);
  return Number.isFinite(updatedMs) && updatedMs < sinceMs;
}

function toChatSummary(row: HeaderRow, filters: SummaryFilters): CursorChatSummary | null {
  if (!filters.includeArchived && row.isArchived === 1) {
    return null;
  }
  if (!filters.includeSubagents && row.isSubagent === 1) {
    return null;
  }
  const head = parseHeaderValue(row.value);
  const { createdAt, lastUpdatedAt } = resolveSummaryTimestamps(row, head);
  if (isOlderThan(lastUpdatedAt, filters.sinceMs)) {
    return null;
  }
  const title = head?.name?.trim() || null;
  const subtitle = head?.subtitle?.trim() || null;
  if (filters.query && !matchesQuery(filters.query, title, subtitle, row.subagentTypeName)) {
    return null;
  }
  return {
    composerId: row.composerId,
    title,
    cwd: workspacePathFromUri(head?.workspaceIdentifier),
    subtitle,
    createdAt,
    lastUpdatedAt,
    messageCount: 0,
    isArchived: row.isArchived === 1,
    isSubagent: row.isSubagent === 1,
    subagentTypeName: row.subagentTypeName,
  };
}

export function listCursorChats(
  db: CursorSqliteDatabase,
  options: ListCursorChatsOptions = {},
): CursorChatSummary[] {
  const filters: SummaryFilters = {
    includeArchived: options.includeArchived === true,
    includeSubagents: options.includeSubagents === true,
    query: options.query?.trim().toLowerCase() ?? "",
    sinceMs: options.since ? options.since.getTime() : null,
  };
  const limit = Math.max(1, options.limit ?? 500);

  const summaries = queryHeaderRows(db).flatMap((row) => {
    const summary = toChatSummary(row, filters);
    return summary ? [summary] : [];
  });

  summaries.sort((a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt));
  return summaries.slice(0, limit);
}

function matchesQuery(
  query: string,
  title: string | null,
  subtitle: string | null,
  subagentTypeName: string | null,
): boolean {
  return [title, subtitle, subagentTypeName].some((value) =>
    value ? value.toLowerCase().includes(query) : false,
  );
}

function readComposerData(
  db: CursorSqliteDatabase,
  composerId: string,
): z.infer<typeof composerDataSchema> | null {
  const row = db
    .prepare("SELECT value FROM cursorDiskKV WHERE key = ?")
    .get(`composerData:${composerId}`);
  if (!row || typeof row !== "object" || !("value" in row)) {
    return null;
  }
  const raw = (row as { value: unknown }).value;
  if (typeof raw !== "string") {
    return null;
  }
  try {
    return composerDataSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function readHeader(db: CursorSqliteDatabase, composerId: string): HeaderRow | null {
  const row = db
    .prepare(
      "SELECT composerId, createdAt, lastUpdatedAt, isArchived, isSubagent, subagentTypeName, value FROM composerHeaders WHERE composerId = ?",
    )
    .get(composerId);
  return row ? parseHeaderRow(row) : null;
}

function readBubbles(
  db: CursorSqliteDatabase,
  composerId: string,
): Map<string, z.infer<typeof bubbleSchema>> {
  if (!COMPOSER_ID_PATTERN.test(composerId)) {
    throw new CursorImportError(
      "cursor.invalid_composer_id",
      `Invalid Cursor composer id: ${composerId}`,
    );
  }
  const rows = db
    .prepare("SELECT value FROM cursorDiskKV WHERE key GLOB ?")
    .all(`bubbleId:${composerId}:*`);
  const bubbles = new Map<string, z.infer<typeof bubbleSchema>>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || !("value" in row)) {
      continue;
    }
    const raw = (row as { value: unknown }).value;
    if (typeof raw !== "string") {
      continue;
    }
    try {
      const parsed = bubbleSchema.parse(JSON.parse(raw));
      const bubbleId = parsed.bubbleId;
      if (bubbleId) {
        bubbles.set(bubbleId, parsed);
      }
    } catch {
      // A single corrupt bubble must not hide the rest of the transcript.
    }
  }
  return bubbles;
}

function resolveChatTimestamps(
  header: HeaderRow | null,
  data: z.infer<typeof composerDataSchema> | null,
  head: ReturnType<typeof parseHeaderValue>,
): { createdAt: string; lastUpdatedAt: string } {
  const createdAt = toIso(
    header?.createdAt ?? data?.createdAt ?? head?.createdAt,
    new Date(0).toISOString(),
  );
  const lastUpdatedAt = toIso(
    header?.lastUpdatedAt ?? data?.lastUpdatedAt ?? head?.lastUpdatedAt,
    createdAt,
  );
  return { createdAt, lastUpdatedAt };
}

function resolveChatModelName(
  data: z.infer<typeof composerDataSchema> | null,
  messages: readonly CursorChatMessage[],
): string | null {
  const configured = data?.modelConfig?.modelName?.trim();
  if (configured) {
    return configured;
  }
  return messages.findLast((message) => message.modelName)?.modelName ?? null;
}

function resolveChatTitle(
  head: ReturnType<typeof parseHeaderValue>,
  data: z.infer<typeof composerDataSchema> | null,
): string | null {
  return head?.name?.trim() || data?.name?.trim() || null;
}

function resolveChatWorkspace(
  head: ReturnType<typeof parseHeaderValue>,
  data: z.infer<typeof composerDataSchema> | null,
): string | null {
  return (
    workspacePathFromUri(head?.workspaceIdentifier) ??
    workspacePathFromUri(data?.workspaceIdentifier)
  );
}

function resolveSubagentFields(
  header: HeaderRow | null,
  data: z.infer<typeof composerDataSchema> | null,
): Pick<CursorChat, "parentComposerId" | "subagentTypeName" | "toolCallId"> {
  return {
    parentComposerId: data?.subagentInfo?.parentComposerId?.trim() || null,
    subagentTypeName:
      header?.subagentTypeName?.trim() || data?.subagentInfo?.subagentTypeName?.trim() || null,
    toolCallId: data?.subagentInfo?.toolCallId?.trim() || null,
  };
}

export function readCursorChat(db: CursorSqliteDatabase, composerId: string): CursorChat {
  const header = readHeader(db, composerId);
  const data = readComposerData(db, composerId);
  if (!header && !data) {
    throw new CursorImportError("cursor.chat_missing", `Cursor chat not found: ${composerId}`);
  }

  const head = header ? parseHeaderValue(header.value) : null;
  const { createdAt, lastUpdatedAt } = resolveChatTimestamps(header, data, head);
  const orderedBubbles = orderBubbles(
    data?.fullConversationHeadersOnly ?? [],
    readBubbles(db, composerId),
  );
  const messages = orderedBubbles.flatMap((bubble) => {
    const message = toChatMessage(bubble);
    return message ? [message] : [];
  });

  return {
    composerId,
    title: resolveChatTitle(head, data),
    cwd: resolveChatWorkspace(head, data),
    createdAt,
    lastUpdatedAt,
    modelName: resolveChatModelName(data, messages),
    isArchived: header?.isArchived === 1,
    isSubagent: header?.isSubagent === 1,
    ...resolveSubagentFields(header, data),
    messages,
  };
}

function orderBubbles(
  headers: readonly z.infer<typeof conversationHeaderSchema>[],
  bubbles: Map<string, z.infer<typeof bubbleSchema>>,
): z.infer<typeof bubbleSchema>[] {
  const ordered: z.infer<typeof bubbleSchema>[] = [];
  const seen = new Set<string>();
  for (const header of headers) {
    const bubble = bubbles.get(header.bubbleId);
    if (!bubble) {
      continue;
    }
    ordered.push(bubble);
    seen.add(header.bubbleId);
  }
  const missing = [...bubbles.entries()]
    .filter(([bubbleId]) => !seen.has(bubbleId))
    .map(([, bubble]) => bubble)
    .sort((a, b) => bubbleTime(a).localeCompare(bubbleTime(b)));
  return [...ordered, ...missing];
}

function bubbleTime(bubble: z.infer<typeof bubbleSchema>): string {
  return bubble.createdAt ?? "";
}

function roleForBubbleType(type: number): CursorChatRole | null {
  if (type === 1) return "user";
  if (type === 2) return "assistant";
  return null;
}

function toChatMessage(bubble: z.infer<typeof bubbleSchema>): CursorChatMessage | null {
  const role = roleForBubbleType(bubble.type);
  if (!role) {
    return null;
  }
  const tool = toToolCall(bubble.toolFormerData);
  const text = role === "user" ? cleanUserText(bubble.text) : (bubble.text ?? "").trim();
  const thinking =
    role === "assistant" ? truncate(bubble.thinking?.text?.trim() ?? "", MAX_THINKING_CHARS) : "";
  if (!text && !thinking && !tool) {
    return null;
  }
  return {
    bubbleId: bubble.bubbleId ?? "",
    role,
    text: truncate(text, MAX_MESSAGE_CHARS),
    thinking: thinking || null,
    createdAt: bubble.createdAt ?? "",
    modelName: bubble.modelInfo?.modelName?.trim() || null,
    tool,
  };
}

function toToolCall(raw: z.infer<typeof bubbleSchema>["toolFormerData"]): CursorToolCall | null {
  if (!raw?.name) {
    return null;
  }
  return {
    callId: raw.toolCallId?.trim() || null,
    name: raw.name,
    status: normalizeToolStatus(raw.status),
    params: truncate(raw.params ?? "", MAX_TOOL_RESULT_CHARS) || null,
    result: truncate(stringifyResult(raw.result), MAX_TOOL_RESULT_CHARS) || null,
  };
}

function normalizeToolStatus(status: string | undefined): CursorToolCall["status"] {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "failed" || normalized === "error") {
    return "failed";
  }
  if (normalized === "canceled" || normalized === "cancelled" || normalized === "aborted") {
    return "canceled";
  }
  return "completed";
}

function stringifyResult(result: unknown): string {
  if (result === null || result === undefined) {
    return "";
  }
  if (typeof result === "string") {
    return result;
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

const LEADING_TIMESTAMP_BLOCK = /^<timestamp>[\s\S]*?<\/timestamp>\s*/;
const LEADING_SYSTEM_NOTIFICATION = /^<system_notification>[\s\S]*?<\/system_notification>\s*/;
const LEADING_REPOSITORY_PATH = /^Full Repository Path: [^\n]*\n+/;

/**
 * Cursor wraps user turns with bookkeeping the IDE hides: a timestamp block, a
 * system-notification block, and the attached repository path. Keeping them
 * makes imported transcripts noisy and confuses the model on continuation.
 */
export function cleanUserText(raw: string | undefined): string {
  if (!raw) {
    return "";
  }
  let text = raw;
  for (let index = 0; index < 4; index += 1) {
    const before = text;
    text = text
      .replace(LEADING_TIMESTAMP_BLOCK, "")
      .replace(LEADING_SYSTEM_NOTIFICATION, "")
      .replace(LEADING_REPOSITORY_PATH, "");
    if (text === before) {
      break;
    }
  }
  return text.trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}\n\n[truncated]`;
}

/**
 * Parent-to-children mapping. Cursor records the link on the child's
 * `subagentInfo`, so the parent's own `subComposerIds` cannot be trusted.
 */
export function listCursorSubagentLinks(db: CursorSqliteDatabase): Map<string, string[]> {
  const rows = db
    .prepare(
      `SELECT key AS composerKey, json_extract(value, '$.subagentInfo.parentComposerId') AS parentId
       FROM cursorDiskKV
       WHERE key GLOB 'composerData:*'
         AND json_extract(value, '$.subagentInfo.parentComposerId') IS NOT NULL`,
    )
    .all();
  const links = new Map<string, string[]>();
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const { composerKey, parentId } = row as { composerKey?: unknown; parentId?: unknown };
    if (typeof composerKey !== "string" || typeof parentId !== "string" || !parentId) {
      continue;
    }
    const childId = composerKey.startsWith("composerData:")
      ? composerKey.slice("composerData:".length)
      : composerKey;
    const children = links.get(parentId) ?? [];
    children.push(childId);
    links.set(parentId, children);
  }
  return links;
}

/** Cheap model lookup for list rows: SQL-only, never parses the full composer. */
export function readCursorChatModel(db: CursorSqliteDatabase, composerId: string): string | null {
  const row = db
    .prepare(
      "SELECT json_extract(value, '$.modelConfig.modelName') AS model FROM cursorDiskKV WHERE key = ?",
    )
    .get(`composerData:${composerId}`);
  const model = (row as { model?: unknown } | undefined)?.model;
  return typeof model === "string" && model.trim().length > 0 ? model.trim() : null;
}

export function countCursorChats(db: CursorSqliteDatabase): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM composerHeaders").get();
  const count = (row as { count?: unknown } | undefined)?.count;
  return typeof count === "number" ? count : 0;
}
