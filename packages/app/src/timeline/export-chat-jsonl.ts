import type { FetchAgentTimelineResponseMessage } from "@getpaseo/protocol/messages";

export type ChatExportTimelineEntry =
  FetchAgentTimelineResponseMessage["payload"]["entries"][number];

export const CHAT_EXPORT_MIME_TYPE = "application/x-ndjson";

export interface ChatExportFile {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}

export interface ExportAgentChatInput {
  title: string | null;
  agentId: string;
  fetchTimeline: () => Promise<{ entries: readonly ChatExportTimelineEntry[] }>;
  saveFile: (file: ChatExportFile) => Promise<void>;
}

interface ChatExportLine {
  timestamp: string;
  provider: ChatExportTimelineEntry["provider"];
  turnId?: string;
  seq: number;
  item: ChatExportTimelineEntry["item"];
}

const UNSAFE_FILE_NAME_CHARACTERS = /[\\/:*?"<>|]+/g;

export function chatExportFileName(title: string | null, agentId: string): string {
  const fromTitle = sanitizeChatExportBase(title ?? "");
  const base = fromTitle.length > 0 ? fromTitle : sanitizeChatExportBase(agentId);
  return `${base.length > 0 ? base : "chat"}.jsonl`;
}

export function formatChatJsonl(entries: readonly ChatExportTimelineEntry[]): string {
  if (entries.length === 0) {
    return "";
  }
  return `${entries.map((entry) => JSON.stringify(toChatExportLine(entry))).join("\n")}\n`;
}

export async function exportAgentChat(input: ExportAgentChatInput): Promise<{ fileName: string }> {
  const page = await input.fetchTimeline();
  const fileName = chatExportFileName(input.title, input.agentId);
  await input.saveFile({
    bytes: new TextEncoder().encode(formatChatJsonl(page.entries)),
    fileName,
    mimeType: CHAT_EXPORT_MIME_TYPE,
  });
  return { fileName };
}

function toChatExportLine(entry: ChatExportTimelineEntry): ChatExportLine {
  const line: ChatExportLine = {
    timestamp: entry.timestamp,
    provider: entry.provider,
    seq: entry.seqEnd,
    item: entry.item,
  };
  if (entry.turnId !== undefined) {
    line.turnId = entry.turnId;
  }
  return line;
}

function stripControlCharacters(value: string): string {
  let stripped = "";
  for (const character of value) {
    if (character.charCodeAt(0) <= 0x1f) continue;
    stripped += character;
  }
  return stripped;
}

function sanitizeChatExportBase(value: string): string {
  const withoutControls = stripControlCharacters(value);
  const sanitized = withoutControls
    .replace(UNSAFE_FILE_NAME_CHARACTERS, "-")
    .replace(/\s+/g, " ")
    .trim();
  const trimmed = sanitized.replace(/^-+|-+$/g, "");
  if (trimmed === "." || trimmed === "..") {
    return "";
  }
  return trimmed;
}
