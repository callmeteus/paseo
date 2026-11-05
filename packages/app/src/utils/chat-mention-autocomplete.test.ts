import { describe, expect, it } from "vitest";
import {
  filterAndRankChatMentions,
  removeMentionToken,
  type ChatMentionCandidate,
} from "./chat-mention-autocomplete";

function chat(overrides: Partial<ChatMentionCandidate> = {}): ChatMentionCandidate {
  return {
    serverId: "server-1",
    agentId: "agent-1",
    title: "Fix the login flow",
    cwd: "/repo",
    archived: false,
    lastActivity: 100,
    ...overrides,
  };
}

describe("filterAndRankChatMentions", () => {
  it("returns recent chats when the query is empty", () => {
    const result = filterAndRankChatMentions({
      chats: [
        chat({ agentId: "older", lastActivity: 10 }),
        chat({ agentId: "newer", lastActivity: 500 }),
      ],
      query: "",
    });

    expect(result.map((entry) => entry.agentId)).toEqual(["newer", "older"]);
  });

  it("keeps chats whose title starts with the query ahead of content matches", () => {
    const result = filterAndRankChatMentions({
      chats: [
        chat({ agentId: "body", title: "Unrelated", snippet: "mentions attach here" }),
        chat({ agentId: "title", title: "Attach menu" }),
      ],
      query: "attach",
    });

    expect(result.map((entry) => entry.agentId)).toEqual(["title", "body"]);
  });

  it("finds a chat by its workspace name", () => {
    const result = filterAndRankChatMentions({
      chats: [
        chat({ agentId: "ws", title: "Fix the crash", workspaceName: "plano de busca" }),
        chat({ agentId: "other", title: "Unrelated" }),
      ],
      query: "plano de busca",
    });

    expect(result.map((entry) => entry.agentId)).toEqual(["ws"]);
  });

  it("ranks a title match above a workspace match and both above content", () => {
    const result = filterAndRankChatMentions({
      chats: [
        chat({ agentId: "content", title: "Other", snippet: "plano de busca mentioned" }),
        chat({ agentId: "workspace", title: "Other", workspaceName: "plano de busca" }),
        chat({ agentId: "title", title: "plano de busca notes" }),
      ],
      query: "plano de busca",
    });

    expect(result.map((entry) => entry.agentId)).toEqual(["title", "workspace", "content"]);
  });

  it("drops chats that match neither title nor snippet", () => {
    const result = filterAndRankChatMentions({
      chats: [chat({ agentId: "nope", title: "Other" })],
      query: "attach",
    });

    expect(result).toEqual([]);
  });

  it("never offers the chat being composed in", () => {
    const result = filterAndRankChatMentions({
      chats: [chat({ agentId: "self" }), chat({ agentId: "other" })],
      query: "",
      excludeAgentId: "self",
    });

    expect(result.map((entry) => entry.agentId)).toEqual(["other"]);
  });

  it("ranks live chats above archived ones with the same title rank", () => {
    const result = filterAndRankChatMentions({
      chats: [
        chat({ agentId: "archived", archived: true, lastActivity: 900 }),
        chat({ agentId: "live", archived: false, lastActivity: 10 }),
      ],
      query: "login",
    });

    expect(result.map((entry) => entry.agentId)).toEqual(["live", "archived"]);
  });

  it("dedupes the same chat reported by both sources", () => {
    const result = filterAndRankChatMentions({
      chats: [chat({ agentId: "same" }), chat({ agentId: "same", snippet: "login retry" })],
      query: "login",
    });

    expect(result).toHaveLength(1);
  });

  it("respects the limit", () => {
    const result = filterAndRankChatMentions({
      chats: [chat({ agentId: "a" }), chat({ agentId: "b" }), chat({ agentId: "c" })],
      query: "login",
      limit: 2,
    });

    expect(result).toHaveLength(2);
  });
});

describe("removeMentionToken", () => {
  it("removes the typed token and keeps the surrounding text", () => {
    expect(
      removeMentionToken({
        text: "look at @login now",
        mention: { start: 8, end: 14, query: "login" },
      }),
    ).toBe("look at  now");
  });

  it("leaves text without a mention untouched when the range is empty", () => {
    expect(removeMentionToken({ text: "hello", mention: { start: 5, end: 5, query: "" } })).toBe(
      "hello",
    );
  });
});
