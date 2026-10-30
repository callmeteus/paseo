/**
 * Normalized view of a Cursor IDE chat.
 *
 * Cursor stores chats in `state.vscdb` as `composerData:<id>` rows plus one
 * `bubbleId:<composerId>:<bubbleId>` row per message. These types are the
 * provider-neutral shape the importer works with, so the timeline mapper and
 * the daemon never touch Cursor's raw JSON.
 */

export type CursorChatRole = "user" | "assistant";

export interface CursorToolCall {
  callId: string | null;
  name: string;
  status: "completed" | "failed" | "canceled";
  /** Raw JSON string Cursor stored for the call arguments. */
  params: string | null;
  /** Rendered result text, already reduced to a bounded string. */
  result: string | null;
}

export interface CursorChatMessage {
  bubbleId: string;
  role: CursorChatRole;
  text: string;
  thinking: string | null;
  createdAt: string;
  modelName: string | null;
  tool: CursorToolCall | null;
}

export interface CursorChat {
  composerId: string;
  title: string | null;
  /** Workspace folder Cursor recorded for the chat, or null for project-less chats. */
  cwd: string | null;
  createdAt: string;
  lastUpdatedAt: string;
  modelName: string | null;
  isArchived: boolean;
  isSubagent: boolean;
  parentComposerId: string | null;
  subagentTypeName: string | null;
  toolCallId: string | null;
  messages: CursorChatMessage[];
}

export interface CursorChatSummary {
  composerId: string;
  title: string | null;
  cwd: string | null;
  subtitle: string | null;
  createdAt: string;
  lastUpdatedAt: string;
  messageCount: number;
  isArchived: boolean;
  isSubagent: boolean;
  subagentTypeName: string | null;
}

export class CursorImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CursorImportError";
  }
}
