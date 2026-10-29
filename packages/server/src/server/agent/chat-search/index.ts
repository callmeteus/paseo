import MarkdownIt from "markdown-it";
import { setImmediate } from "node:timers/promises";
import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
import { projectTimelineRows } from "../timeline-projection.js";

const markdown = new MarkdownIt({ html: false });
const PAGE_SIZE = 200;
interface SearchLocation {
  seq: number;
  role: "user" | "assistant";
  count: number;
}
interface SearchInput {
  rows: readonly AgentTimelineRow[];
  query: string;
  cursor?: number;
}

// Discovery is deliberately approximate. Only the client can verify displayed text, so
// `count` estimates rendered occurrences and the client replaces it with the rendered
// count once the message is on screen. Blocks are counted separately, and the Markdown
// source is never searched whole, because a match the client cannot highlight — across
// a block boundary, or on syntax the reader never sees — still inflates the total until
// navigation reaches that message and drops it.
function searchableBlocks(text: string): string[] {
  return markdown
    .parse(text, {})
    .map((token) => {
      if (token.type === "inline") {
        return (token.children ?? [])
          .map((child) => {
            if (child.type === "text" || child.type === "code_inline") return child.content;
            if (child.type === "softbreak" || child.type === "hardbreak") return "\n";
            return "";
          })
          .join("");
      }
      if (token.type === "fence" || token.type === "code_block") return token.content;
      return "";
    })
    .filter(Boolean);
}

function searchPattern(query: string): RegExp {
  const source = query
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(source, "giu");
}

function countMatches(text: string, pattern: RegExp): number {
  let count = 0;
  for (const _ of text.matchAll(pattern)) count += 1;
  return count;
}

const SNIPPET_CONTEXT_CHARS = 90;

export interface ChatTextMatch {
  seq: number;
  role: "user" | "assistant";
  snippet: string;
}

/**
 * Finds the first occurrence of `query` in each user/assistant message and
 * returns a readable excerpt around it. Used by cross-chat search (MCP
 * `search_chats`), where the caller needs context rather than a count.
 */
export function findChatTextMatches(input: {
  items: readonly {
    seq: number;
    item: { type: string; text?: string };
  }[];
  query: string;
  maxMatches?: number;
}): ChatTextMatch[] {
  const maxMatches = input.maxMatches ?? 3;
  if (!input.query.trim() || maxMatches <= 0) return [];
  const pattern = searchPattern(input.query);
  const results: ChatTextMatch[] = [];
  for (const entry of input.items) {
    const item = entry.item;
    if (item.type !== "user_message" && item.type !== "assistant_message") continue;
    if (typeof item.text !== "string") continue;
    const text = item.text.replace(/\r/g, "");
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (!match) continue;
    const start = Math.max(0, match.index - SNIPPET_CONTEXT_CHARS);
    const end = Math.min(text.length, match.index + match[0].length + SNIPPET_CONTEXT_CHARS);
    const excerpt = text.slice(start, end).replace(/\s+/g, " ").trim();
    results.push({
      seq: entry.seq,
      role: item.type === "user_message" ? "user" : "assistant",
      snippet: `${start > 0 ? "…" : ""}${excerpt}${end < text.length ? "…" : ""}`,
    });
    if (results.length >= maxMatches) break;
  }
  return results;
}

export async function searchTimeline({ rows, query, cursor = 0 }: SearchInput) {
  const locations: SearchLocation[] = [];
  if (!query.trim()) return { locations, nextCursor: null };
  const pattern = searchPattern(query);
  let lastYield = performance.now();
  for (const entry of projectTimelineRows({ rows, mode: "projected" })) {
    if (entry.seqEnd <= cursor) continue;
    const item = entry.item;
    if (item.type !== "user_message" && item.type !== "assistant_message") continue;
    const raw = item.text.replace(/\r/g, "");
    const blocks = item.type === "assistant_message" ? searchableBlocks(raw) : [raw];
    const count = blocks.reduce((sum, block) => sum + countMatches(block, pattern), 0);
    if (count) {
      if (locations.length === PAGE_SIZE) {
        return { locations, nextCursor: locations[PAGE_SIZE - 1]!.seq };
      }
      locations.push({
        seq: entry.seqEnd,
        role: item.type === "user_message" ? "user" : "assistant",
        count,
      });
    }
    if (performance.now() - lastYield >= 8) {
      await setImmediate();
      lastYield = performance.now();
    }
  }
  return { locations, nextCursor: null };
}
