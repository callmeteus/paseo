import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

interface FixtureSqliteModule {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...params: unknown[]): unknown };
    close(): void;
  };
}

// node:sqlite is newer than this workspace's @types/node; load it the same way
// the usage-source plugins do.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as FixtureSqliteModule;

export interface FixtureBubble {
  bubbleId: string;
  type: 1 | 2;
  text?: string;
  thinking?: string;
  createdAt: string;
  modelName?: string;
  tool?: {
    name: string;
    status?: string;
    params?: unknown;
    result?: unknown;
    callId?: string;
  };
}

export interface FixtureChat {
  composerId: string;
  name: string | null;
  subtitle: string | null;
  cwd: string | null;
  createdAt: number;
  lastUpdatedAt: number;
  isArchived?: boolean;
  isSubagent?: boolean;
  subagentTypeName?: string | null;
  modelName: string;
  parentComposerId?: string;
  toolCallId?: string;
  bubbles: FixtureBubble[];
}

export function createCursorFixtureDb(chats: FixtureChat[], directories: string[]): string {
  const directory = mkdtempSync(path.join(tmpdir(), "paseo-cursor-fixture-"));
  directories.push(directory);
  const dbPath = path.join(directory, "state.vscdb");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE composerHeaders (
      composerId TEXT PRIMARY KEY,
      workspaceId TEXT,
      createdAt INTEGER,
      lastUpdatedAt INTEGER,
      isArchived INTEGER,
      isSubagent INTEGER,
      recency INTEGER,
      checkpointAt INTEGER,
      value TEXT,
      subagentTypeName TEXT
    );
    CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB);
  `);

  for (const chat of chats) {
    db.prepare(
      "INSERT INTO composerHeaders (composerId, createdAt, lastUpdatedAt, isArchived, isSubagent, recency, value, subagentTypeName) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      chat.composerId,
      chat.createdAt,
      chat.lastUpdatedAt,
      chat.isArchived ? 1 : 0,
      chat.isSubagent ? 1 : 0,
      chat.lastUpdatedAt,
      JSON.stringify({
        type: "head",
        name: chat.name,
        subtitle: chat.subtitle,
        ...(chat.cwd ? { workspaceIdentifier: { uri: { fsPath: chat.cwd, scheme: "file" } } } : {}),
      }),
      chat.subagentTypeName ?? null,
    );

    const headers = chat.bubbles.map((bubble) => ({
      bubbleId: bubble.bubbleId,
      type: bubble.type,
      createdAt: bubble.createdAt,
    }));
    db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
      `composerData:${chat.composerId}`,
      JSON.stringify({
        composerId: chat.composerId,
        modelConfig: { modelName: chat.modelName },
        fullConversationHeadersOnly: headers,
        ...(chat.parentComposerId
          ? {
              subagentInfo: {
                parentComposerId: chat.parentComposerId,
                toolCallId: chat.toolCallId,
                subagentTypeName: chat.subagentTypeName,
              },
            }
          : {}),
      }),
    );

    for (const bubble of chat.bubbles) {
      db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
        `bubbleId:${chat.composerId}:${bubble.bubbleId}`,
        JSON.stringify({
          type: bubble.type,
          bubbleId: bubble.bubbleId,
          text: bubble.text ?? "",
          createdAt: bubble.createdAt,
          ...(bubble.thinking ? { thinking: { text: bubble.thinking } } : {}),
          ...(bubble.modelName ? { modelInfo: { modelName: bubble.modelName } } : {}),
          ...(bubble.tool
            ? {
                toolFormerData: {
                  name: bubble.tool.name,
                  status: bubble.tool.status ?? "completed",
                  params: bubble.tool.params ? JSON.stringify(bubble.tool.params) : undefined,
                  result: bubble.tool.result,
                  toolCallId: bubble.tool.callId,
                },
              }
            : {}),
        }),
      );
    }
  }
  db.close();
  return dbPath;
}

export function cleanupFixtureDirectories(directories: string[]): void {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function mainFixtureChat(overrides: Partial<FixtureChat> = {}): FixtureChat {
  return {
    composerId: "11111111-1111-4111-8111-111111111111",
    name: "ArtDirector graphic design system",
    subtitle: "Edited Formats.test.ts",
    cwd: "C:\\Users\\Gio\\Documents\\Projetos\\Pacotes\\artdirector",
    createdAt: Date.parse("2026-10-21T21:10:56.000Z"),
    lastUpdatedAt: Date.parse("2026-10-21T22:47:36.000Z"),
    modelName: "composer-2.5",
    bubbles: [
      {
        bubbleId: "b1",
        type: 1,
        text: "<timestamp>Wednesday</timestamp>\nFull Repository Path: c:\\repo\n\nCria o system de design",
        createdAt: "2026-10-21T22:41:11.656Z",
      },
      {
        bubbleId: "b2",
        type: 2,
        thinking: "Preciso mapear os arquivos.",
        createdAt: "2026-10-21T22:41:12.000Z",
      },
      {
        bubbleId: "b3",
        type: 2,
        createdAt: "2026-10-21T22:41:13.000Z",
        tool: {
          name: "run_terminal_command_v2",
          params: { command: "npm test" },
          result: { output: "ok" },
          callId: "tool_1",
        },
      },
      {
        bubbleId: "b4",
        type: 2,
        text: "Pronto, rodei os testes.",
        createdAt: "2026-10-21T22:41:14.000Z",
        modelName: "grok-4.6",
      },
    ],
    ...overrides,
  };
}
