import { chmod, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { AgentTimelineRow } from "../../agent/agent-timeline-store-types.js";
import {
  cursorTranscriptLines,
  writeBackFinishedCursorImport,
  type CursorTranscriptSourceRow,
} from "./transcript-writeback.js";

const COMPOSER_ID = "11111111-1111-4111-8111-111111111111";
const PARENT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";
const CWD = "/home/gio/Projetos Pessoais";
const SLUG = "home-gio-Projetos-Pessoais";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function row(
  seqEnd: number,
  item: CursorTranscriptSourceRow["item"],
  turnId?: string,
): CursorTranscriptSourceRow {
  return {
    seqEnd,
    timestamp: "2026-11-05T18:00:00.000Z",
    ...(turnId ? { turnId } : {}),
    item,
  };
}

function originalLine(): string {
  return `${JSON.stringify({
    role: "user",
    message: { content: [{ type: "text", text: "original question" }] },
  })}\n`;
}

async function tempProjects(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "paseo-cursor-transcript-"));
  directories.push(root);
  return root;
}

function transcriptPath(root: string, ...parts: string[]): string {
  return join(root, SLUG, "agent-transcripts", ...parts);
}

describe("cursorTranscriptLines", () => {
  test("puts the finished turn on user and assistant lines, including tool calls", () => {
    const lines = cursorTranscriptLines([
      row(2, { type: "user_message", text: 'continue "this"' }, "turn-1"),
      row(3, { type: "reasoning", text: "thinking" }, "turn-1"),
      row(4, { type: "assistant_message", text: "answer" }, "turn-1"),
      row(
        5,
        {
          type: "tool_call",
          callId: "call-1",
          name: "Shell",
          status: "completed",
          error: null,
          detail: { type: "shell", command: "pwd" },
        },
        "turn-1",
      ),
      row(6, { type: "assistant_message", text: "[System Error] boom" }, "turn-1"),
    ]);

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      {
        role: "user",
        message: { content: [{ type: "text", text: 'continue "this"' }] },
      },
      {
        role: "assistant",
        message: {
          content: [
            { type: "text", text: "thinking\n\nanswer" },
            { type: "tool_use", name: "Shell", input: { command: "pwd" } },
          ],
        },
      },
    ]);
  });
});

describe("writeBackFinishedCursorImport", () => {
  test("appends a finished run to the original transcript and keeps that history on the imported chat", async () => {
    const root = await tempProjects();
    const path = transcriptPath(root, COMPOSER_ID, `${COMPOSER_ID}.jsonl`);
    await mkdir(join(path, ".."), { recursive: true });
    const original = originalLine();
    await writeFile(path, original, "utf8");
    const other = transcriptPath(root, OTHER_ID, `${OTHER_ID}.jsonl`);
    await mkdir(join(other, ".."), { recursive: true });
    await writeFile(other, original, "utf8");
    const existing: AgentTimelineRow[] = [
      {
        seq: 1,
        timestamp: "2026-10-21T21:10:56.000Z",
        item: { type: "user_message", text: "original question" },
      },
    ];

    const result = await writeBackFinishedCursorImport({
      outcome: "completed",
      projectsRoot: root,
      cwd: CWD,
      composerId: COMPOSER_ID,
      turnId: "turn-1",
      existingPortedTimeline: existing,
      rows: [
        row(1, { type: "user_message", text: "original question" }),
        row(2, { type: "user_message", text: "continue this" }, "turn-1"),
        row(3, { type: "assistant_message", text: "done" }, "turn-1"),
        row(4, { type: "assistant_message", text: "failed attempt" }, "turn-failed"),
      ],
    });

    const written = await readFile(path, "utf8");
    expect(written.startsWith(original)).toBe(true);
    expect(written.match(/original question/g)).toHaveLength(1);
    expect(written).not.toContain("failed attempt");
    expect(written).toContain("continue this");
    expect(written).toContain("done");
    expect(await readFile(other, "utf8")).toBe(original);
    expect(result.transcript).toMatchObject({ status: "appended", path, lineCount: 2 });
    expect(result.portedTimeline?.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(result.portedTimeline?.[0]?.item).toEqual({
      type: "user_message",
      text: "original question",
    });

    const second = await writeBackFinishedCursorImport({
      outcome: "completed",
      projectsRoot: root,
      cwd: CWD,
      composerId: COMPOSER_ID,
      turnId: "turn-1",
      existingPortedTimeline: result.portedTimeline ?? existing,
      rows: [
        row(1, { type: "user_message", text: "original question" }),
        row(2, { type: "user_message", text: "continue this" }, "turn-1"),
        row(3, { type: "assistant_message", text: "done" }, "turn-1"),
      ],
    });
    expect(second.transcript).toMatchObject({ status: "skipped", reason: "already_present" });
    expect(second.portedTimeline).toBeNull();
    expect(await readFile(path, "utf8")).toBe(written);
  });

  test("writes the imported history plus the run when the transcript file does not exist yet", async () => {
    const root = await tempProjects();
    const result = await writeBackFinishedCursorImport({
      outcome: "completed",
      projectsRoot: root,
      cwd: CWD,
      composerId: COMPOSER_ID,
      turnId: "turn-1",
      existingPortedTimeline: [
        {
          seq: 1,
          timestamp: "2026-10-21T21:10:56.000Z",
          item: { type: "user_message", text: "original question" },
        },
      ],
      rows: [
        row(1, { type: "user_message", text: "original question" }),
        row(2, { type: "assistant_message", text: "original answer" }),
        row(3, { type: "user_message", text: "continue this" }, "turn-1"),
        row(4, { type: "assistant_message", text: "done" }, "turn-1"),
      ],
    });

    const path = transcriptPath(root, COMPOSER_ID, `${COMPOSER_ID}.jsonl`);
    const written = await readFile(path, "utf8");
    expect(written).toContain("original question");
    expect(written).toContain("original answer");
    expect(written).toContain("continue this");
    expect(result.transcript).toMatchObject({ status: "appended", path });
    expect(result.portedTimeline?.map((entry) => entry.seq)).toEqual([1, 3, 4]);
  });

  test("appends a subagent run to that subagent file only", async () => {
    const root = await tempProjects();
    const child = transcriptPath(root, PARENT_ID, "subagents", `${COMPOSER_ID}.jsonl`);
    const parent = transcriptPath(root, PARENT_ID, `${PARENT_ID}.jsonl`);
    await mkdir(join(child, ".."), { recursive: true });
    await mkdir(join(parent, ".."), { recursive: true });
    const original = originalLine();
    await writeFile(child, original, "utf8");
    await writeFile(parent, original, "utf8");

    const result = await writeBackFinishedCursorImport({
      outcome: "completed",
      projectsRoot: root,
      cwd: CWD,
      composerId: COMPOSER_ID,
      parentComposerId: PARENT_ID,
      turnId: "turn-1",
      rows: [row(2, { type: "assistant_message", text: "subagent result" }, "turn-1")],
    });

    expect(result.transcript).toMatchObject({ status: "appended", path: child });
    expect(await readFile(parent, "utf8")).toBe(original);
    expect(await readFile(child, "utf8")).toContain("subagent result");
    expect(await readFile(child, "utf8")).toContain("original question");
  });

  test("a failed or canceled run does not change the original transcript or the stored history", async () => {
    const root = await tempProjects();
    const path = transcriptPath(root, COMPOSER_ID, `${COMPOSER_ID}.jsonl`);
    await mkdir(join(path, ".."), { recursive: true });
    const original = originalLine();
    await writeFile(path, original, "utf8");
    const existing: AgentTimelineRow[] = [
      {
        seq: 1,
        timestamp: "2026-10-21T21:10:56.000Z",
        item: { type: "user_message", text: "original question" },
      },
    ];
    const input = {
      projectsRoot: root,
      cwd: CWD,
      composerId: COMPOSER_ID,
      turnId: "turn-1",
      existingPortedTimeline: existing,
      rows: [
        row(1, { type: "user_message", text: "original question" }),
        row(2, { type: "user_message", text: "partial" }, "turn-1"),
        row(3, { type: "assistant_message", text: "[System Error] boom" }, "turn-1"),
      ],
    };

    for (const outcome of ["failed", "canceled"] as const) {
      const result = await writeBackFinishedCursorImport({ ...input, outcome });
      expect(result.transcript).toEqual({ status: "skipped", reason: "not_finished", path: null });
      expect(result.portedTimeline).toBeNull();
    }
    expect(await readFile(path, "utf8")).toBe(original);
  });

  test("a failed append leaves the original transcript bytes in place", async () => {
    const root = await tempProjects();
    const path = transcriptPath(root, COMPOSER_ID, `${COMPOSER_ID}.jsonl`);
    await mkdir(join(path, ".."), { recursive: true });
    const original = originalLine();
    await writeFile(path, original, "utf8");
    await chmod(path, 0o444);

    try {
      const result = await writeBackFinishedCursorImport({
        outcome: "completed",
        projectsRoot: root,
        cwd: CWD,
        composerId: COMPOSER_ID,
        turnId: "turn-1",
        existingPortedTimeline: [
          {
            seq: 1,
            timestamp: "2026-10-21T21:10:56.000Z",
            item: { type: "user_message", text: "original question" },
          },
        ],
        rows: [row(2, { type: "assistant_message", text: "should not land" }, "turn-1")],
      });

      expect(result.transcript.status).toBe("failed");
      expect(result.portedTimeline).toBeNull();
      expect(await readFile(path, "utf8")).toBe(original);
    } finally {
      await chmod(path, 0o644);
    }
  });
});
