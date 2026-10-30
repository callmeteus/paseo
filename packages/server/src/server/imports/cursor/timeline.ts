import type { AgentTimelineItem, ImportedTimelineEntry } from "../../agent/agent-sdk-types.js";
import type { ToolCallDetail, ToolCallTimelineItem } from "../../agent/agent-sdk-types.js";
import type { CursorChat, CursorChatMessage, CursorToolCall } from "./types.js";

// Cursor chats are long: a 1k-message chat is ~570k characters. Keep whole
// chats by default and only trim the oldest entries of the rare giants, so the
// imported record stays portable without losing the original prompt.
const DEFAULT_MAX_ITEMS = 2_000;
const DEFAULT_MAX_CHARS = 800_000;
const MAX_TOOL_DETAIL_CHARS = 4_000;

export interface CursorTimelineOptions {
  maxItems?: number;
  maxChars?: number;
}

interface PendingEntry extends ImportedTimelineEntry {
  chars: number;
}

/**
 * Convert a Cursor IDE chat into Paseo timeline entries.
 *
 * Cursor's message list interleaves user turns, assistant prose, reasoning and
 * tool calls. The mapping is lossy by design: tool payloads are summarized to
 * bounded strings so a long imported chat stays renderable and portable.
 */
export function cursorChatToTimeline(
  chat: CursorChat,
  options: CursorTimelineOptions = {},
): ImportedTimelineEntry[] {
  const maxItems = Math.max(1, options.maxItems ?? DEFAULT_MAX_ITEMS);
  const maxChars = Math.max(1, options.maxChars ?? DEFAULT_MAX_CHARS);

  const entries: PendingEntry[] = [];
  for (const message of chat.messages) {
    for (const item of messageToItems(message)) {
      entries.push({
        item,
        timestamp: message.createdAt || chat.lastUpdatedAt,
        chars: itemCharWeight(item),
      });
    }
  }

  return boundEntries(entries, maxItems, maxChars);
}

function boundEntries(
  entries: PendingEntry[],
  maxItems: number,
  maxChars: number,
): ImportedTimelineEntry[] {
  let start = Math.max(0, entries.length - maxItems);
  let chars = entries.slice(start).reduce((total, entry) => total + entry.chars, 0);
  while (start < entries.length - 1 && chars > maxChars) {
    chars -= entries[start]?.chars ?? 0;
    start += 1;
  }
  const kept = entries.slice(start).map(({ item, timestamp }) => ({ item, timestamp }));
  if (start === 0) {
    return kept;
  }
  const omitted = start;
  const notice: AgentTimelineItem = {
    type: "notification",
    level: "info",
    message: `Transcrição antiga omitida: ${omitted} ${
      omitted === 1 ? "entrada" : "entradas"
    } do início deste chat do Cursor não foram importadas.`,
  };
  return [{ item: notice, timestamp: kept[0]?.timestamp ?? new Date().toISOString() }, ...kept];
}

function itemCharWeight(item: AgentTimelineItem): number {
  switch (item.type) {
    case "user_message":
    case "assistant_message":
    case "reasoning":
      return item.text.length;
    case "tool_call":
      return JSON.stringify(item.detail ?? {}).length;
    default:
      return 0;
  }
}

function messageToItems(message: CursorChatMessage): AgentTimelineItem[] {
  if (message.role === "user") {
    return message.text ? [{ type: "user_message", text: message.text }] : [];
  }
  const items: AgentTimelineItem[] = [];
  if (message.thinking) {
    items.push({ type: "reasoning", text: message.thinking });
  }
  if (message.tool) {
    items.push(toolCallItem(message));
  }
  if (message.text) {
    items.push({ type: "assistant_message", text: message.text });
  }
  return items;
}

function toolCallItem(message: CursorChatMessage): ToolCallTimelineItem {
  const tool = message.tool as CursorToolCall;
  const callId = tool.callId ?? `${message.bubbleId}:tool`;
  const base = {
    type: "tool_call" as const,
    callId,
    name: tool.name,
    detail: toolDetail(tool),
  };
  if (tool.status === "failed") {
    return {
      ...base,
      status: "failed",
      error: { message: tool.result?.trim() || `${tool.name} failed` },
    };
  }
  if (tool.status === "canceled") {
    return { ...base, status: "canceled", error: null };
  }
  return { ...base, status: "completed", error: null };
}

interface ToolParams {
  [key: string]: unknown;
}

function parseParams(raw: string | null): ToolParams {
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ToolParams)
      : {};
  } catch {
    return {};
  }
}

function paramString(params: ToolParams, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function shellDetail(tool: CursorToolCall, params: ToolParams): ToolCallDetail | null {
  const name = tool.name.toLowerCase();
  if (!name.includes("terminal") && !name.includes("run_command")) {
    return null;
  }
  const command = paramString(params, ["command", "cmd", "commandLine"]) ?? tool.name;
  return {
    type: "shell",
    command: truncate(command, MAX_TOOL_DETAIL_CHARS),
    output: tool.result ?? undefined,
  };
}

function readDetail(tool: CursorToolCall, params: ToolParams): ToolCallDetail | null {
  const name = tool.name.toLowerCase();
  if (!name.startsWith("read_file") && name !== "read") {
    return null;
  }
  const filePath =
    paramString(params, ["targetFile", "relativeWorkspacePath", "path", "filePath"]) ?? tool.name;
  return { type: "read", filePath, content: tool.result ?? undefined };
}

function editDetail(tool: CursorToolCall, params: ToolParams): ToolCallDetail | null {
  const name = tool.name.toLowerCase();
  const isWrite = name.includes("write_file");
  if (!name.includes("edit_file") && name !== "edit" && name !== "write" && !isWrite) {
    return null;
  }
  const filePath =
    paramString(params, ["relativeWorkspacePath", "targetFile", "path", "filePath"]) ?? tool.name;
  if (isWrite) {
    return { type: "write", filePath, content: tool.result ?? undefined };
  }
  return { type: "edit", filePath, unifiedDiff: tool.result ?? undefined };
}

function searchToolName(name: string): "glob" | "grep" | "search" {
  if (name.includes("glob")) return "glob";
  if (name.includes("ripgrep") || name.includes("grep")) return "grep";
  return "search";
}

function searchDetail(tool: CursorToolCall, params: ToolParams): ToolCallDetail | null {
  const name = tool.name.toLowerCase();
  const matchKeys = name.includes("glob")
    ? ["globPattern", "pattern", "query"]
    : ["pattern", "query", "searchTerm", "globPattern"];
  const query = paramString(params, matchKeys);
  if (!query && !name.includes("search") && !name.includes("grep")) {
    return null;
  }
  return {
    type: "search",
    query: query ?? tool.name,
    toolName: searchToolName(name),
    content: tool.result ?? undefined,
  };
}

function fetchDetail(tool: CursorToolCall, params: ToolParams): ToolCallDetail | null {
  const name = tool.name.toLowerCase();
  if (!name.includes("web") && !name.includes("fetch") && !name.includes("browse")) {
    return null;
  }
  return {
    type: "fetch",
    url: paramString(params, ["url", "uri"]) ?? tool.name,
    result: tool.result ?? undefined,
  };
}

function plainDetail(tool: CursorToolCall, params: ToolParams): ToolCallDetail {
  const summary = paramString(params, ["step", "description", "title", "query"]);
  return {
    type: "plain_text",
    label: tool.name,
    text: truncate(summary ?? tool.result ?? "", MAX_TOOL_DETAIL_CHARS) || undefined,
  };
}

function toolDetail(tool: CursorToolCall): ToolCallDetail {
  const params = parseParams(tool.params);
  return (
    shellDetail(tool, params) ??
    readDetail(tool, params) ??
    editDetail(tool, params) ??
    searchDetail(tool, params) ??
    fetchDetail(tool, params) ??
    plainDetail(tool, params)
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n\n[truncated]`;
}
