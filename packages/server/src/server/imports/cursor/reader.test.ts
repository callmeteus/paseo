import { afterEach, describe, expect, test } from "vitest";

import { listCursorChats, listCursorSubagentLinks, readCursorChat } from "./reader.js";
import { openCursorStateDb } from "./state-db.js";
import { cursorChatToTimeline } from "./timeline.js";
import { suggestContinuationProvider } from "./model-map.js";
import {
  cleanupFixtureDirectories,
  createCursorFixtureDb,
  mainFixtureChat,
} from "./test-fixtures.js";

const directories: string[] = [];

afterEach(() => {
  cleanupFixtureDirectories(directories);
});

describe("listCursorChats", () => {
  test("hides archived and subagent chats by default and keeps project paths", () => {
    const db = openCursorStateDb(
      createCursorFixtureDb(
        [
          mainFixtureChat(),
          mainFixtureChat({
            composerId: "22222222-2222-4222-8222-222222222222",
            name: "Archived chat",
            isArchived: true,
          }),
          mainFixtureChat({
            composerId: "33333333-3333-4333-8333-333333333333",
            name: "Explore subagent",
            isSubagent: true,
            subagentTypeName: "explore",
            parentComposerId: "11111111-1111-4111-8111-111111111111",
          }),
        ],
        directories,
      ),
    );

    const chats = listCursorChats(db);
    expect(chats.map((chat) => chat.composerId)).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(chats[0]).toMatchObject({
      title: "ArtDirector graphic design system",
      cwd: "C:\\Users\\Gio\\Documents\\Projetos\\Pacotes\\artdirector",
    });

    expect(listCursorChats(db, { includeArchived: true })).toHaveLength(2);
    expect(listCursorChats(db, { includeSubagents: true })).toHaveLength(2);
    db.close();
  });

  test("filters by a case-insensitive query", () => {
    const db = openCursorStateDb(createCursorFixtureDb([mainFixtureChat()], directories));
    expect(listCursorChats(db, { query: "artdirector" })).toHaveLength(1);
    expect(listCursorChats(db, { query: "nothing" })).toHaveLength(0);
    db.close();
  });
});

describe("readCursorChat", () => {
  test("orders bubbles, strips Cursor wrappers and keeps tool calls", () => {
    const db = openCursorStateDb(createCursorFixtureDb([mainFixtureChat()], directories));
    const chat = readCursorChat(db, "11111111-1111-4111-8111-111111111111");

    expect(chat.modelName).toBe("composer-2.5");
    expect(chat.messages).toHaveLength(4);
    expect(chat.messages[0]).toMatchObject({
      role: "user",
      text: "Cria o system de design",
    });
    expect(chat.messages[1]).toMatchObject({
      role: "assistant",
      thinking: "Preciso mapear os arquivos.",
    });
    expect(chat.messages[2]?.tool).toMatchObject({
      name: "run_terminal_command_v2",
      callId: "tool_1",
      status: "completed",
    });
    expect(chat.messages[3]?.modelName).toBe("grok-4.6");
    db.close();
  });

  test("maps subagent linkage from the child side", () => {
    const db = openCursorStateDb(
      createCursorFixtureDb(
        [
          mainFixtureChat(),
          mainFixtureChat({
            composerId: "33333333-3333-4333-8333-333333333333",
            name: "Explore subagent",
            isSubagent: true,
            subagentTypeName: "explore",
            parentComposerId: "11111111-1111-4111-8111-111111111111",
            toolCallId: "tool_9",
          }),
        ],
        directories,
      ),
    );
    expect(listCursorSubagentLinks(db).get("11111111-1111-4111-8111-111111111111")).toEqual([
      "33333333-3333-4333-8333-333333333333",
    ]);
    db.close();
  });
});

describe("cursorChatToTimeline", () => {
  test("maps reasoning, shell tool calls, assistant text and user turns in order", () => {
    const db = openCursorStateDb(createCursorFixtureDb([mainFixtureChat()], directories));
    const chat = readCursorChat(db, "11111111-1111-4111-8111-111111111111");
    const timeline = cursorChatToTimeline(chat);

    expect(timeline.map((entry) => entry.item.type)).toEqual([
      "user_message",
      "reasoning",
      "tool_call",
      "assistant_message",
    ]);
    expect(timeline[2]?.item).toMatchObject({
      type: "tool_call",
      status: "completed",
      detail: { type: "shell", command: "npm test" },
    });
    db.close();
  });

  test("keeps the tail and prepends a notice when the transcript is too long", () => {
    const db = openCursorStateDb(createCursorFixtureDb([mainFixtureChat()], directories));
    const chat = readCursorChat(db, "11111111-1111-4111-8111-111111111111");
    const timeline = cursorChatToTimeline(chat, { maxItems: 2, maxChars: 800_000 });

    expect(timeline).toHaveLength(3);
    expect(timeline[0]?.item).toMatchObject({ type: "notification" });
    expect(timeline.at(-1)?.item.type).toBe("assistant_message");
    db.close();
  });
});

describe("suggestContinuationProvider", () => {
  test("flags Cursor-only models and maps portable families", () => {
    expect(suggestContinuationProvider("composer-2.5")).toMatchObject({
      portable: false,
      family: "cursor",
    });
    expect(suggestContinuationProvider("default").portable).toBe(false);
    expect(suggestContinuationProvider("claude-sonnet-5-thinking-high")).toMatchObject({
      portable: true,
      preferredProviders: ["claude"],
    });
    expect(suggestContinuationProvider("gpt-5.3-codex").preferredProviders).toEqual([
      "codex",
      "opencode",
    ]);
    expect(suggestContinuationProvider("grok-4.7").preferredProviders).toEqual([
      "opencode",
      "kilo",
      "cline",
    ]);
  });
});
