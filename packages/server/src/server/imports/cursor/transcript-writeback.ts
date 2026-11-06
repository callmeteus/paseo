import { appendFile, mkdir, open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import type { AgentTimelineItem, ToolCallDetail } from "../../agent/agent-sdk-types.js";
import type { AgentTimelineRow } from "../../agent/agent-timeline-store-types.js";

const TRANSCRIPTS_DIR = "agent-transcripts";
const MAX_ID_CHARS = 200;
const ID_PATTERN = /^[A-Za-z0-9-]+$/;
/** Same prefix AgentManager records when a turn fails. Those rows are not transcript history. */
const SYSTEM_ERROR_PREFIX = "[System Error]";

export type CursorImportRunOutcome = "completed" | "failed" | "canceled";

export interface CursorTranscriptSourceRow {
  turnId?: string;
  timestamp: string;
  seqEnd: number;
  item: AgentTimelineItem;
}

export interface WriteBackFinishedCursorImportInput {
  outcome: CursorImportRunOutcome;
  projectsRoot: string;
  cwd: string;
  composerId: string;
  parentComposerId?: string | null;
  turnId: string;
  rows: readonly CursorTranscriptSourceRow[];
  existingPortedTimeline?: readonly AgentTimelineRow[];
}

export type CursorTranscriptWriteStatus =
  | { status: "appended"; path: string; lineCount: number }
  | { status: "skipped"; reason: "empty" | "already_present" | "not_finished"; path: string | null }
  | { status: "failed"; path: string | null; error: string };

export interface WriteBackFinishedCursorImportResult {
  transcript: CursorTranscriptWriteStatus;
  /**
   * Stored transcript after the finished turn is included, or null when the
   * stored copy must stay as it was.
   */
  portedTimeline: AgentTimelineRow[] | null;
}

interface TranscriptPaths {
  canonical: string;
  search: string[];
}

interface TranscriptContentPart {
  type: "text" | "tool_use";
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/**
 * Default directory Cursor uses for per-project transcripts (`~/.cursor/projects`).
 */
export function defaultCursorProjectsRoot(home: string = homedir()): string {
  return join(home, ".cursor", "projects");
}

/**
 * Project folder name Cursor derives from a workspace path.
 *
 * Non-letters become hyphens, repeated hyphens collapse, and the leading
 * separator is dropped. `/home/gio/Projetos Pessoais` is `home-gio-Projetos-Pessoais`.
 */
export function cursorProjectSlug(cwd: string): string {
  return cwd
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Append one finished run of an imported Cursor chat to that chat's transcript.
 *
 * The file is only appended. A failed or canceled outcome returns without
 * reading or writing it, and a failed append leaves the bytes that were already
 * there. When the transcript does not exist yet, the new file is the imported
 * history plus this run, so the original conversation is not replaced by the
 * delta alone.
 */
export async function writeBackFinishedCursorImport(
  input: WriteBackFinishedCursorImportInput,
): Promise<WriteBackFinishedCursorImportResult> {
  if (input.outcome !== "completed") {
    return {
      transcript: { status: "skipped", reason: "not_finished", path: null },
      portedTimeline: null,
    };
  }

  const turnRows = rowsForTurn(input.rows, input.turnId);
  if (turnRows.length === 0) {
    return {
      transcript: { status: "skipped", reason: "empty", path: null },
      portedTimeline: null,
    };
  }

  const paths = resolveTranscriptPaths(input);
  if (!paths) {
    return {
      transcript: {
        status: "failed",
        path: null,
        error: "Cursor chat id is not a safe transcript path",
      },
      portedTimeline: null,
    };
  }

  try {
    const existing = await findExistingTranscript(paths.search);
    const target = existing ?? paths.canonical;
    const size = existing === null ? null : await fileSize(existing);
    const source =
      size === null || size === 0 ? rowsForNewFile(input.rows, input.turnId) : turnRows;
    const lines = cursorTranscriptLines(source);
    if (lines.length === 0) {
      return {
        transcript: { status: "skipped", reason: "empty", path: null },
        portedTimeline: null,
      };
    }
    const transcript = await appendTranscriptLines(target, lines);
    if (transcript.status === "failed") {
      return { transcript, portedTimeline: null };
    }
    return {
      transcript,
      portedTimeline: mergePortedTimeline(input.existingPortedTimeline, turnRows.map(toStoredRow)),
    };
  } catch (error) {
    return {
      transcript: {
        status: "failed",
        path: null,
        error: error instanceof Error ? error.message : String(error),
      },
      portedTimeline: null,
    };
  }
}

/**
 * JSONL lines Cursor stores for a transcript: one user or assistant message per line.
 * Tool calls sit on the assistant line. System errors and other bookkeeping are omitted.
 */
export function cursorTranscriptLines(rows: readonly CursorTranscriptSourceRow[]): string[] {
  const lines: string[] = [];
  let role: "user" | "assistant" | null = null;
  let parts: TranscriptContentPart[] = [];

  const flush = (): void => {
    if (!role || parts.length === 0) {
      role = null;
      parts = [];
      return;
    }
    lines.push(JSON.stringify({ role, message: { content: parts } }));
    role = null;
    parts = [];
  };

  for (const row of rows) {
    if (isSystemError(row.item)) continue;
    if (row.item.type === "user_message") {
      flush();
      const text = row.item.text;
      if (text.trim().length === 0) continue;
      role = "user";
      parts = [{ type: "text", text }];
      flush();
      continue;
    }
    if (row.item.type === "assistant_message" || row.item.type === "reasoning") {
      const text = row.item.text;
      if (text.trim().length === 0) continue;
      if (role !== "assistant") {
        flush();
        role = "assistant";
        parts = [];
      }
      pushText(parts, text);
      continue;
    }
    if (row.item.type === "tool_call") {
      if (role !== "assistant") {
        flush();
        role = "assistant";
        parts = [];
      }
      parts.push({
        type: "tool_use",
        name: row.item.name.trim() || "tool",
        input: toolCallInput(row.item.detail),
      });
    }
  }
  flush();
  return lines;
}

function rowsForTurn(
  rows: readonly CursorTranscriptSourceRow[],
  turnId: string,
): CursorTranscriptSourceRow[] {
  return rows.filter((row) => row.turnId === turnId && isTranscriptRow(row));
}

function rowsForNewFile(
  rows: readonly CursorTranscriptSourceRow[],
  turnId: string,
): CursorTranscriptSourceRow[] {
  return rows.filter((row) => (!row.turnId || row.turnId === turnId) && isTranscriptRow(row));
}

function isTranscriptRow(row: CursorTranscriptSourceRow): boolean {
  if (isSystemError(row.item)) return false;
  switch (row.item.type) {
    case "user_message":
    case "assistant_message":
    case "reasoning":
      return row.item.text.trim().length > 0;
    case "tool_call":
      return true;
    default:
      return false;
  }
}

function isSystemError(item: AgentTimelineItem): boolean {
  return item.type === "assistant_message" && item.text.startsWith(SYSTEM_ERROR_PREFIX);
}

function pushText(parts: TranscriptContentPart[], text: string): void {
  const last = parts[parts.length - 1];
  if (last?.type === "text" && last.text) {
    last.text = `${last.text}\n\n${text}`;
    return;
  }
  parts.push({ type: "text", text });
}

function toolCallInput(detail: ToolCallDetail): Record<string, unknown> {
  switch (detail.type) {
    case "shell":
      return shellToolInput(detail);
    case "read":
      return { path: detail.filePath };
    case "edit":
      return editToolInput(detail);
    case "write":
      return writeToolInput(detail);
    case "search":
      return { query: detail.query };
    case "fetch":
      return { url: detail.url };
    case "plain_text":
      return plainTextToolInput(detail);
    case "plan":
      return { text: detail.text };
    case "sub_agent":
      return subAgentToolInput(detail);
    case "worktree_setup":
      return { worktreePath: detail.worktreePath, branchName: detail.branchName };
    case "unknown":
      return isRecord(detail.input) ? detail.input : {};
    default: {
      const unreachable: never = detail;
      return unreachable;
    }
  }
}

function shellToolInput(
  detail: Extract<ToolCallDetail, { type: "shell" }>,
): Record<string, unknown> {
  return { command: detail.command, ...(detail.cwd ? { cwd: detail.cwd } : {}) };
}

function editToolInput(detail: Extract<ToolCallDetail, { type: "edit" }>): Record<string, unknown> {
  return {
    path: detail.filePath,
    ...(detail.oldString !== undefined ? { old_string: detail.oldString } : {}),
    ...(detail.newString !== undefined ? { new_string: detail.newString } : {}),
  };
}

function writeToolInput(
  detail: Extract<ToolCallDetail, { type: "write" }>,
): Record<string, unknown> {
  return {
    path: detail.filePath,
    ...(detail.content !== undefined ? { contents: detail.content } : {}),
  };
}

function plainTextToolInput(
  detail: Extract<ToolCallDetail, { type: "plain_text" }>,
): Record<string, unknown> {
  return {
    ...(detail.label ? { label: detail.label } : {}),
    ...(detail.text ? { text: detail.text } : {}),
  };
}

function subAgentToolInput(
  detail: Extract<ToolCallDetail, { type: "sub_agent" }>,
): Record<string, unknown> {
  return {
    ...(detail.description ? { description: detail.description } : {}),
    ...(detail.subAgentType ? { subagent_type: detail.subAgentType } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStoredRow(row: CursorTranscriptSourceRow): AgentTimelineRow {
  return {
    seq: row.seqEnd,
    timestamp: row.timestamp,
    item: row.item,
    ...(row.turnId ? { turnId: row.turnId } : {}),
  };
}

function mergePortedTimeline(
  existing: readonly AgentTimelineRow[] | undefined,
  turnRows: readonly AgentTimelineRow[],
): AgentTimelineRow[] | null {
  if (turnRows.length === 0) return null;
  const prior = existing ?? [];
  const seen = new Set(prior.map((row) => row.seq));
  const added = turnRows.filter((row) => !seen.has(row.seq));
  if (added.length === 0) return null;
  return [...prior, ...added].sort((left, right) => left.seq - right.seq);
}

function resolveTranscriptPaths(
  input: Pick<
    WriteBackFinishedCursorImportInput,
    "projectsRoot" | "cwd" | "composerId" | "parentComposerId"
  >,
): TranscriptPaths | null {
  const slug = cursorProjectSlug(input.cwd);
  const id = transcriptFileId(input.composerId);
  if (!slug || !id) return null;
  const root = resolve(input.projectsRoot);
  const dir = join(root, slug, TRANSCRIPTS_DIR);
  const primary = join(dir, id, `${id}.jsonl`);
  const legacy = join(dir, `${id}.jsonl`);
  const parentId = input.parentComposerId ? transcriptFileId(input.parentComposerId) : null;
  if (input.parentComposerId && !parentId) return null;
  const subagent = parentId ? join(dir, parentId, "subagents", `${id}.jsonl`) : null;
  const search = [subagent, primary, legacy].filter((path): path is string => path !== null);
  const canonical = subagent ?? primary;
  if (!search.every((path) => isInsideRoot(root, path))) return null;
  return { canonical, search };
}

function transcriptFileId(id: string): string | null {
  const trimmed = id.trim();
  if (!ID_PATTERN.test(trimmed)) return null;
  const encoded = encodeURIComponent(trimmed).replace(/%/g, "_");
  if (encoded.length === 0 || encoded.length > MAX_ID_CHARS) return null;
  return encoded;
}

function isInsideRoot(root: string, candidate: string): boolean {
  const resolved = resolve(candidate);
  return resolved === root || resolved.startsWith(`${root}${sep}`);
}

async function findExistingTranscript(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch (error) {
      if (!isMissingPath(error)) throw error;
    }
  }
  return null;
}

async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch (error) {
    if (isMissingPath(error)) return null;
    throw error;
  }
}

function isMissingPath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function appendTranscriptLines(
  path: string,
  lines: readonly string[],
): Promise<CursorTranscriptWriteStatus> {
  const chunk = `${lines.join("\n")}\n`;
  let payload = chunk;
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      return { status: "failed", path, error: "Cursor transcript path is not a file" };
    }
    if (info.size > 0 && (await fileEndsWith(path, chunk))) {
      return { status: "skipped", reason: "already_present", path };
    }
    if (info.size > 0 && !(await fileEndsWith(path, "\n"))) {
      payload = `\n${chunk}`;
    }
  } catch (error) {
    if (!isMissingPath(error)) {
      return {
        status: "failed",
        path,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, payload, "utf8");
  } catch (error) {
    return {
      status: "failed",
      path,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return { status: "appended", path, lineCount: lines.length };
}

async function fileEndsWith(path: string, suffix: string): Promise<boolean> {
  const suffixBytes = Buffer.from(suffix);
  if (suffixBytes.length === 0) return true;
  const info = await stat(path);
  if (info.size < suffixBytes.length) return false;
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(suffixBytes.length);
    const { bytesRead } = await handle.read(
      buffer,
      0,
      buffer.length,
      info.size - suffixBytes.length,
    );
    return bytesRead === suffixBytes.length && buffer.equals(suffixBytes);
  } finally {
    await handle.close();
  }
}
