import { Command } from "commander";

import { connectToDaemon } from "../../utils/client.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { withOutput } from "../../output/index.js";
import type { CommandError, CommandOptions, ListResult, OutputSchema } from "../../output/index.js";

interface CursorCommandOptions extends CommandOptions {
  project?: string;
  since?: string;
  query?: string;
  subagents?: boolean;
  archived?: boolean;
  limit?: string;
}

interface CursorImportOptions extends CursorCommandOptions {
  all?: boolean;
}

export interface CursorChatRow {
  composerId: string;
  title: string;
  project: string;
  model: string;
  updated: string;
  importedAgentId: string;
}

export interface CursorImportRow {
  composerId: string;
  agentId: string;
  title: string;
  status: string;
  messages: string;
  error: string;
}

export const cursorListSchema: OutputSchema<CursorChatRow> = {
  idField: "composerId",
  columns: [
    { header: "CHAT ID", field: "composerId", width: 38 },
    { header: "TITLE", field: "title", width: 34 },
    { header: "PROJECT", field: "project", width: 28 },
    { header: "MODEL", field: "model", width: 20 },
    { header: "UPDATED", field: "updated", width: 17 },
    { header: "AGENT", field: "importedAgentId", width: 10 },
  ],
};

export const cursorImportSchema: OutputSchema<CursorImportRow> = {
  idField: "agentId",
  columns: [
    { header: "AGENT ID", field: "agentId", width: 38 },
    { header: "STATUS", field: "status", width: 17 },
    { header: "TITLE", field: "title", width: 34 },
    { header: "MSGS", field: "messages", width: 6 },
    { header: "ERROR", field: "error", width: 30 },
  ],
};

export function createCursorCommand(): Command {
  const cursor = new Command("cursor").description(
    "Read Cursor IDE chats into Paseo (read-only; Cursor is never modified)",
  );

  addJsonAndDaemonHostOptions(
    cursor
      .command("list")
      .description("List Cursor IDE chats available for import")
      .option("--project <path>", "Only chats recorded for this workspace folder")
      .option("--since <date>", "Only chats updated on or after this ISO date")
      .option("--query <text>", "Filter by title or subtitle")
      .option("--subagents", "Include Cursor subagent chats")
      .option("--archived", "Include archived chats")
      .option("--limit <count>", "Maximum number of chats to list", "200"),
  ).action(withOutput(runCursorList));

  addJsonAndDaemonHostOptions(
    cursor
      .command("import")
      .description("Import Cursor IDE chats as read-only Paseo agents")
      .argument("[composerIds...]", "Cursor composer ids to import")
      .option("--project <path>", "Import every chat recorded for this workspace folder")
      .option("--since <date>", "Only import chats updated on or after this ISO date")
      .option("--query <text>", "Filter by title or subtitle")
      .option("--all", "Import every chat that matches the filters")
      .option("--subagents", "Include Cursor subagent chats")
      .option("--archived", "Include archived chats")
      .option("--limit <count>", "Maximum number of chats to select with --all", "200"),
  ).action(withOutput(runCursorImport));

  return cursor;
}

export async function runCursorList(
  options: CursorCommandOptions,
  _command: Command,
): Promise<ListResult<CursorChatRow>> {
  const client = await connectToDaemon({ target: options.daemonTarget });
  try {
    const payload = await client.listCursorImportChats({
      ...(options.project ? { cwd: options.project } : {}),
      ...(options.since ? { since: options.since } : {}),
      ...(options.query ? { query: options.query } : {}),
      includeSubagents: options.subagents === true,
      includeArchived: options.archived === true,
      ...(options.limit ? { limit: parseLimit(options.limit) } : {}),
    });
    if (payload.error && !payload.sourceAvailable) {
      throw cursorError("CURSOR_NOT_FOUND", payload.error);
    }
    if (payload.error) {
      throw cursorError("CURSOR_LIST_FAILED", payload.error);
    }
    return {
      type: "list",
      data: payload.chats.map((chat) => ({
        composerId: chat.composerId,
        title: chat.title ?? "(untitled)",
        project: chat.cwd ?? "(no workspace)",
        model: chat.model ?? "-",
        updated: formatTimestamp(chat.lastUpdatedAt),
        importedAgentId: chat.importedAgentId?.slice(0, 7) ?? "-",
      })),
      schema: cursorListSchema,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

export async function runCursorImport(
  composerIds: string[],
  options: CursorImportOptions,
  _command: Command,
): Promise<ListResult<CursorImportRow>> {
  const client = await connectToDaemon({ target: options.daemonTarget });
  try {
    const selected = await resolveSelection(client, composerIds, options);
    if (selected.length === 0) {
      throw cursorError(
        "CURSOR_NOTHING_TO_IMPORT",
        "No Cursor chats matched. Pass composer ids or use --all with filters.",
      );
    }
    const payload = await client.importCursorChats({
      composerIds: selected,
      includeSubagents: options.subagents === true,
    });
    if (payload.error) {
      throw cursorError("CURSOR_IMPORT_FAILED", payload.error);
    }
    return {
      type: "list",
      data: payload.chats.map((chat) => ({
        composerId: chat.composerId,
        agentId: chat.agentId ?? "-",
        title: chat.title ?? "(untitled)",
        status: chat.status,
        messages: String(chat.messageCount),
        error: chat.error ?? "",
      })),
      schema: cursorImportSchema,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

async function resolveSelection(
  client: Awaited<ReturnType<typeof connectToDaemon>>,
  composerIds: string[],
  options: CursorImportOptions,
): Promise<string[]> {
  if (composerIds.length > 0) {
    return composerIds;
  }
  if (!options.all) {
    throw cursorError(
      "CURSOR_SELECTION_REQUIRED",
      "Pass one or more composer ids, or use --all (optionally with --project/--since/--query).",
    );
  }
  const payload = await client.listCursorImportChats({
    ...(options.project ? { cwd: options.project } : {}),
    ...(options.since ? { since: options.since } : {}),
    ...(options.query ? { query: options.query } : {}),
    includeSubagents: options.subagents === true,
    includeArchived: options.archived === true,
    ...(options.limit ? { limit: parseLimit(options.limit) } : {}),
  });
  if (payload.error) {
    throw cursorError("CURSOR_LIST_FAILED", payload.error);
  }
  return payload.chats
    .filter((chat) => chat.importedAgentId === null)
    .map((chat) => chat.composerId);
}

function parseLimit(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw cursorError("INVALID_LIMIT", `Invalid --limit value: ${raw}`);
  }
  return parsed;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function cursorError(code: string, message: string): CommandError {
  return { code, message };
}
