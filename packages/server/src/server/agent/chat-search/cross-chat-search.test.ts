import { beforeEach, expect, it } from "vitest";
import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";
import {
  resetChatSearchCache,
  searchChatsAcrossChats,
  type ChatSearchCandidate,
  type ChatSearchEntry,
} from "./cross-chat-search.js";

function candidate(overrides: Partial<ChatSearchCandidate> = {}): ChatSearchCandidate {
  return {
    agentId: "agent-1",
    title: "Deploy notes",
    provider: "claude",
    status: "idle" as AgentLifecycleStatus,
    cwd: "/repo",
    updatedAt: "2026-11-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

function entries(text: string): ChatSearchEntry[] {
  return [{ seq: 1, item: { type: "user_message", text } }];
}

beforeEach(() => {
  resetChatSearchCache();
});

it("finds chats by message text and returns a snippet", async () => {
  const result = await searchChatsAcrossChats({
    chats: [candidate(), candidate({ agentId: "agent-2", title: "Other" })],
    query: "rollback",
    loadEntries: async (agentId) =>
      agentId === "agent-1" ? entries("we should rollback the migration") : entries("nothing here"),
  });

  expect(result).toHaveLength(1);
  expect(result[0]!.agentId).toBe("agent-1");
  expect(result[0]!.titleMatch).toBe(false);
  expect(result[0]!.matches[0]!.snippet).toContain("rollback");
});

it("ranks title matches above content-only matches", async () => {
  const result = await searchChatsAcrossChats({
    chats: [
      candidate({ agentId: "content", title: "Unrelated", updatedAt: "2026-11-02T00:00:00.000Z" }),
      candidate({ agentId: "title", title: "Rollback plan" }),
    ],
    query: "rollback",
    loadEntries: async (agentId) =>
      agentId === "content" ? entries("rollback it") : entries("nothing"),
  });

  expect(result.map((chat) => chat.agentId)).toEqual(["title", "content"]);
});

it("skips chats that match neither title nor text", async () => {
  const result = await searchChatsAcrossChats({
    chats: [candidate()],
    query: "rollback",
    loadEntries: async () => entries("nothing"),
  });

  expect(result).toEqual([]);
});

it("stops scanning a small multiple of the requested results", async () => {
  const chats = Array.from({ length: 10 }, (_, index) =>
    candidate({ agentId: `agent-${index}`, title: "Rollback" }),
  );
  let loads = 0;
  const result = await searchChatsAcrossChats({
    chats,
    query: "rollback",
    limit: 2,
    loadEntries: async () => {
      loads += 1;
      return entries("nothing");
    },
  });

  expect(result).toHaveLength(2);
  expect(loads).toBe(6);
});

it("reuses loaded entries while the chat has not changed", async () => {
  const chat = candidate();
  let loads = 0;
  const loadEntries = async () => {
    loads += 1;
    return entries("rollback");
  };

  await searchChatsAcrossChats({ chats: [chat], query: "roll", loadEntries });
  await searchChatsAcrossChats({ chats: [chat], query: "rollb", loadEntries });

  expect(loads).toBe(1);
});

it("rescans a chat once its updatedAt changes", async () => {
  let loads = 0;
  const loadEntries = async () => {
    loads += 1;
    return entries("rollback");
  };

  await searchChatsAcrossChats({ chats: [candidate()], query: "roll", loadEntries });
  await searchChatsAcrossChats({
    chats: [candidate({ updatedAt: "2026-11-03T00:00:00.000Z" })],
    query: "roll",
    loadEntries,
  });

  expect(loads).toBe(2);
});
