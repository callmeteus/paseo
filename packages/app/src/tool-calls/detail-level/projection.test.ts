import { describe, expect, it } from "vitest";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import {
  prepareToolCallHistory,
  projectToolCallDetailLevel,
  type PreparedToolCallHistory,
  type ToolCallDetailLevel,
} from "./projection";

type AssistantMessageItem = Extract<StreamItem, { kind: "assistant_message" }>;

function toolCall(
  id: string,
  detail: ToolCallDetail,
  options: {
    name?: string;
    status?: "running" | "completed" | "failed" | "canceled";
  } = {},
): ToolCallItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(`2026-01-01T00:00:${id.padStart(2, "0")}.000Z`),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: options.name ?? detail.type,
        status: options.status ?? "completed",
        error: options.status === "failed" ? "boom" : null,
        detail,
      },
    },
  };
}

function assistant(id: string): AssistantMessageItem {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp: new Date("2026-01-01T00:01:00.000Z"),
  };
}

function narration(id: string, text: string): AssistantMessageItem {
  return {
    kind: "assistant_message",
    id,
    text,
    timestamp: new Date(`2026-01-01T00:03:${id.padStart(2, "0")}.000Z`),
  };
}

function thought(id: string, text: string, durationMs?: number): StreamItem {
  const timestamp = new Date(`2026-01-01T00:02:${id.padStart(2, "0")}.000Z`);
  return {
    kind: "thought",
    id,
    text,
    timestamp,
    ...(durationMs === undefined
      ? {}
      : { startedAt: new Date(timestamp.getTime() - durationMs), thinkingDurationMs: durationMs }),
    status: "ready",
  };
}

function project(input: {
  level: ToolCallDetailLevel;
  tail?: StreamItem[];
  head?: StreamItem[];
  isTurnActive?: boolean;
  preparedHistory?: PreparedToolCallHistory | null;
  includeThought?: boolean;
  includeShortText?: boolean;
}) {
  const tail = input.tail ?? [];
  const includeThought = input.includeThought ?? true;
  return projectToolCallDetailLevel({
    level: input.level,
    tail,
    head: input.head ?? [],
    preparedHistory:
      input.preparedHistory ??
      prepareToolCallHistory(input.level, tail, includeThought, input.includeShortText ?? false),
    isTurnActive: input.isTurnActive ?? false,
    includeThought,
  });
}

describe("tool call detail-level projection", () => {
  it.each(["detailed", "overview"] as const)(
    "keeps pending approval tools out of %s presentation without removing their canonical position",
    (level) => {
      const pending = toolCall(
        "1",
        { type: "plan", text: "Ship it" },
        { name: "ExitPlanMode", status: "running" },
      );
      const followUp = {
        kind: "user_message",
        id: "question",
        text: "What about tests?",
        timestamp: new Date(2),
      } satisfies StreamItem;
      const tail = [pending, followUp];
      expect(project({ level, tail }).tail).toEqual([followUp]);
      expect(tail).toEqual([pending, followUp]);
      const rejected = toolCall("1", { type: "plan", text: "Ship it" }, { name: "plan_approval" });
      expect(project({ level, tail: [rejected, followUp] }).tail).toEqual([rejected, followUp]);
    },
  );

  it("keeps a multitask task out of the generic tool group", () => {
    const task = toolCall(
      "1",
      {
        type: "unknown",
        input: {
          _toolName: "task",
          prompt: "Answer why OpenCode did not compact the context",
          description: "Por que não compactou o contexto",
        },
        output: null,
      },
      { name: "other", status: "running" },
    );
    const shell = toolCall("2", { type: "shell", command: "ls" }, { status: "running" });
    const tail = [task, shell];

    expect(project({ level: "detailed", tail }).tail).toEqual([shell]);
    expect(tail).toEqual([task, shell]);

    const overview = project({ level: "overview", head: [task, shell], isTurnActive: true });
    expect(overview.groupsByHostId.size).toBe(1);
    expect(overview.groupsByHostId.get(task.id)).toBeUndefined();
    expect(overview.groupsByHostId.get(shell.id)?.run.calls.map((call) => call.id)).toEqual(["2"]);
    expect(overview.head.some((item) => item.id === task.id)).toBe(false);

    const plainOther = toolCall(
      "3",
      { type: "unknown", input: { command: "ls" }, output: null },
      { name: "other" },
    );
    expect(project({ level: "detailed", tail: [plainOther] }).tail).toEqual([plainOther]);

    const explore = toolCall(
      "4",
      {
        type: "sub_agent",
        subAgentType: "Explore",
        description: "Inspect repository structure",
        log: "",
      },
      { name: "task", status: "running" },
    );
    expect(project({ level: "detailed", tail: [explore] }).tail).toEqual([explore]);
  });

  it("passes detailed timelines through without grouping work", () => {
    const tail = [toolCall("1", { type: "shell", command: "one" })];
    const head = [toolCall("2", { type: "shell", command: "two" })];

    const prepared = prepareToolCallHistory("detailed", tail);
    const result = project({ level: "detailed", tail, head, preparedHistory: prepared });

    expect(prepared).toBeNull();
    expect(result.tail).toBe(tail);
    expect(result.head).toBe(head);
    expect(result.groupsByHostId.size).toBe(0);
  });

  it("keeps one stable overview host as a run grows", () => {
    const firstCall = toolCall("1", { type: "shell", command: "one" });
    const secondCall = toolCall("2", { type: "read", filePath: "/repo/a.ts" });
    const prepared = prepareToolCallHistory("overview", []);

    const single = project({
      level: "overview",
      head: [firstCall],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    expect(single.head).toEqual([firstCall]);
    expect(single.groupsByHostId.get(firstCall.id)?.run).toMatchObject({
      calls: [firstCall],
      latest: firstCall,
      isSealed: false,
    });

    const grouped = project({
      level: "overview",
      head: [firstCall, secondCall],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    expect(grouped.head).toEqual([
      expect.objectContaining({ id: firstCall.id, timestamp: secondCall.timestamp }),
    ]);
    expect(grouped.groupsByHostId.get(firstCall.id)?.run).toMatchObject({
      calls: [firstCall, secondCall],
      latest: secondCall,
      isSealed: false,
    });
  });

  it("keeps a parallel group loading while any call is still running", () => {
    const calls = [
      toolCall("1", { type: "shell", command: "slow" }, { status: "running" }),
      toolCall("2", { type: "shell", command: "done" }),
    ];
    const result = project({ level: "overview", head: calls, isTurnActive: true });

    expect(result.groupsByHostId.get("1")?.isLoading).toBe(true);
  });

  it("builds a loading aggregate for a one-call run", () => {
    const call = toolCall("1", { type: "shell", command: "one" }, { status: "running" });
    const result = project({ level: "overview", head: [call], isTurnActive: true });
    const group = result.groupsByHostId.get(call.id);
    if (!group) {
      throw new Error("Expected an overview group");
    }

    expect(group).toMatchObject({
      isLoading: true,
      summary: { commandCount: 1 },
    });
  });

  it("keeps an active overview group on its latest call until a visible boundary arrives", () => {
    const calls = [
      toolCall("1", { type: "shell", command: "one" }),
      toolCall("2", { type: "read", filePath: "/repo/a.ts" }),
      toolCall("3", { type: "read", filePath: "/repo/b.ts" }),
      toolCall("4", { type: "edit", filePath: "/repo/a.ts" }),
    ];
    const prepared = prepareToolCallHistory("overview", []);
    const active = project({
      level: "overview",
      head: calls,
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const activeGroup = active.groupsByHostId.get("1");

    expect(activeGroup).toMatchObject({
      mode: "overview",
      run: { id: "1", latest: calls[3], isSealed: false },
    });
    const boundary = assistant("answer");
    const sealed = project({
      level: "overview",
      head: [...calls, boundary],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    expect(sealed.groupsByHostId.get("1")).toMatchObject({
      mode: "overview",
      run: { latest: calls[3], isSealed: true },
      summary: { editedFileCount: 1, readFileCount: 2, commandCount: 1 },
    });
  });

  it("keeps a running overview group live before the agent lifecycle catches up", () => {
    const calls = ["1", "2", "3", "4"].map((id) =>
      toolCall(id, { type: "shell", command: id }, { status: "running" }),
    );

    const result = project({
      level: "overview",
      tail: calls,
      isTurnActive: false,
    });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      run: { latest: calls[3], isSealed: false },
      isLoading: true,
      summary: { commandCount: 4 },
    });
  });

  it("seals the trailing overview group only when the turn ends", () => {
    const calls = ["1", "2", "3", "4"].map((id) => toolCall(id, { type: "shell", command: id }));
    const prepared = prepareToolCallHistory("overview", []);

    const betweenCalls = project({
      level: "overview",
      head: calls,
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const nextCall = toolCall("5", { type: "read", filePath: "/repo/a.ts" });
    const continued = project({
      level: "overview",
      head: [...calls, nextCall],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const ended = project({
      level: "overview",
      head: [...calls, nextCall],
      isTurnActive: false,
      preparedHistory: prepared,
    });

    expect(betweenCalls.groupsByHostId.get("1")?.run.isSealed).toBe(false);
    expect(continued.groupsByHostId.get("1")?.run).toMatchObject({
      latest: nextCall,
      isSealed: false,
    });
    expect(ended.groupsByHostId.get("1")?.run.isSealed).toBe(true);
  });

  it("builds overview summaries and separates attempted edits from applied ones", () => {
    const calls = [
      toolCall("1", { type: "read", filePath: "/repo/src/a.ts" }),
      toolCall("2", { type: "read", filePath: "/repo/src/b.ts" }),
      toolCall("3", { type: "shell", command: "npm test" }),
      toolCall("4", { type: "edit", filePath: "/repo/src/a.ts" }, { status: "failed" }),
    ];

    const overview = project({ level: "overview", head: calls });

    expect(overview.groupsByHostId.get("1")).toEqual({
      mode: "overview",
      run: expect.any(Object),
      isLoading: false,
      summary: {
        editedFileCount: 0,
        commandCount: 1,
        readFileCount: 2,
        searchCount: 0,
        fetchCount: 0,
        agentCount: 0,
        otherToolCount: 0,
        paseoCallCount: 0,
        failedFileCount: 1,
        readFiles: ["/repo/src/a.ts", "/repo/src/b.ts"],
        thinkingDurationMs: 0,
        thoughtCount: 0,
        hasText: false,
      },
    });
  });

  it("distinguishes reads, searches, and other tools in overview", () => {
    const calls = [
      toolCall("1", { type: "read", filePath: "/repo/src/a.ts" }),
      toolCall("2", { type: "read", filePath: "C:\\repo\\src\\beta.ts" }),
      toolCall("3", { type: "fetch", url: "https://github.com/org/repo" }),
      toolCall(
        "4",
        { type: "search", query: "paseo", toolName: "web_search" },
        { status: "failed" },
      ),
      toolCall("5", { type: "fetch", url: "not a url" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      summary: {
        editedFileCount: 0,
        commandCount: 0,
        readFileCount: 2,
        searchCount: 1,
        fetchCount: 2,
        otherToolCount: 0,
      },
    });
  });

  it("counts unique edited files and every shell command in overview", () => {
    const calls = [
      toolCall("1", { type: "edit", filePath: "/repo/a.ts" }),
      toolCall("2", { type: "edit", filePath: "/repo/a.ts" }),
      toolCall("3", { type: "write", filePath: "/repo/b.ts" }),
      toolCall("4", { type: "shell", command: "npm test" }),
      toolCall("5", { type: "shell", command: "npm run lint" }),
      toolCall("6", { type: "read", filePath: "/repo/c.ts" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      summary: {
        editedFileCount: 2,
        commandCount: 2,
        readFileCount: 1,
        otherToolCount: 0,
      },
    });
  });

  it("folds reasoning into the tool run it explains", () => {
    const result = project({
      level: "overview",
      head: [
        thought("1", "Planning the change", 2000),
        toolCall("2", { type: "read", filePath: "/repo/a.ts" }),
        thought("3", "Checking the other file", 1500),
        toolCall("4", { type: "read", filePath: "/repo/b.ts" }),
      ],
    });

    const group = result.groupsByHostId.get("1");
    expect(group?.run.steps.map((step) => step.id)).toEqual(["1", "2", "3", "4"]);
    expect(group?.run.calls.map((call) => call.id)).toEqual(["2", "4"]);
    expect(group?.summary).toMatchObject({
      readFileCount: 2,
      thoughtCount: 2,
      thinkingDurationMs: 3500,
    });
  });

  it("keeps reasoning on its own row when the reader always expands reasoning", () => {
    const result = project({
      level: "overview",
      includeThought: false,
      head: [
        thought("1", "Planning the change", 2000),
        toolCall("2", { type: "read", filePath: "/repo/a.ts" }),
        toolCall("3", { type: "read", filePath: "/repo/b.ts" }),
      ],
    });

    // The thought is not folded in, so the tool calls group without it.
    expect(result.groupsByHostId.get("2")?.run.steps.map((step) => step.id)).toEqual(["2", "3"]);
    expect(result.groupsByHostId.get("1")).toBeUndefined();
  });

  it("folds short narration into the work but never the final answer", () => {
    const tail: StreamItem[] = [
      toolCall("1", { type: "read", filePath: "/repo/a.ts" }),
      narration("2", "Now checking the config"),
      toolCall("3", { type: "read", filePath: "/repo/b.ts" }),
      narration(
        "4",
        "Both files agree, so the fix is small. I changed the default and added a test.",
      ),
    ];

    const result = project({ level: "overview", tail, includeShortText: true });

    const group = result.groupsByHostId.get("1");
    expect(group?.run.steps.map((step) => step.id)).toEqual(["1", "2", "3"]);
    expect(group?.summary.hasText).toBe(true);
    // The closing reply stays its own row.
    expect(result.tail.at(-1)).toMatchObject({ kind: "assistant_message", id: "4" });
  });

  it("never folds text that is still streaming", () => {
    const result = project({
      level: "overview",
      includeShortText: true,
      head: [
        toolCall("1", { type: "read", filePath: "/repo/a.ts" }),
        narration("2", "Now checking the config"),
        toolCall("3", { type: "read", filePath: "/repo/b.ts" }),
      ],
    });

    // The streaming line stays visible, so it splits the run into two groups.
    expect(result.groupsByHostId.get("1")?.run.steps.map((step) => step.id)).toEqual(["1"]);
    expect(result.groupsByHostId.get("3")?.run.steps.map((step) => step.id)).toEqual(["3"]);
  });

  it("does not turn a stretch of narration alone into a group", () => {
    const tail: StreamItem[] = [
      narration("1", "One short line"),
      narration("2", "Another short line"),
    ];

    const result = project({ level: "overview", tail, includeShortText: true });

    expect(result.groupsByHostId.size).toBe(0);
    expect(result.tail.map((item) => item.id)).toEqual(["1", "2"]);
  });

  it("never folds a provider failure into a group", () => {
    const tail: StreamItem[] = [
      toolCall("1", { type: "read", filePath: "/repo/a.ts" }),
      narration("2", "Failed to authenticate: OAuth session expired and could not be refreshed"),
      toolCall("3", { type: "read", filePath: "/repo/b.ts" }),
    ];

    const result = project({ level: "overview", tail, includeShortText: true });

    // An error must stay visible, so it splits the run instead of hiding inside it.
    expect(result.groupsByHostId.get("1")?.run.steps.map((step) => step.id)).toEqual(["1"]);
    expect(result.groupsByHostId.get("3")?.run.steps.map((step) => step.id)).toEqual(["3"]);
  });

  it("counts Paseo calls separately from other tools", () => {
    const calls = [
      toolCall("1", { type: "unknown", input: null, output: null }, { name: "paseo.list_agents" }),
      toolCall(
        "2",
        { type: "unknown", input: null, output: null },
        { name: "mcp__paseo__list_worktrees" },
      ),
      toolCall("3", { type: "fetch", url: "https://paseo.sh" }),
      toolCall("4", { type: "fetch", url: "https://github.com/getpaseo" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      summary: { fetchCount: 2, otherToolCount: 0, paseoCallCount: 2 },
    });
  });

  it("classifies direct Brave search and Paseo runtime tool names", () => {
    const unknownDetail = { type: "unknown" as const, input: null, output: null };
    const calls = [
      toolCall("1", unknownDetail, { name: "brave-search_brave_web_search" }),
      toolCall("2", unknownDetail, { name: "brave-search_brave_llm_context" }),
      toolCall("3", unknownDetail, { name: "paseo_list_providers" }),
      toolCall("4", unknownDetail, { name: "paseo_list_worktrees" }),
      toolCall("5", unknownDetail, { name: "paseo_list_worktrees" }),
      toolCall("6", unknownDetail, { name: "mcp__exa__web_search" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      summary: { searchCount: 3, otherToolCount: 0, paseoCallCount: 3 },
    });
  });

  it("reuses prepared history and sealed group models across live-head updates", () => {
    const historicalCalls = ["1", "2", "3", "4"].map((id) =>
      toolCall(id, { type: "shell", command: id }),
    );
    const tail = [...historicalCalls, assistant("boundary")];
    const prepared = prepareToolCallHistory("overview", tail);
    if (!prepared) {
      throw new Error("Overview history must be prepared");
    }
    expect(prepared.grouped.tail).toEqual([
      expect.objectContaining({ id: "1", timestamp: historicalCalls[3]?.timestamp }),
      tail[4],
    ]);
    const first = project({
      level: "overview",
      tail,
      head: [toolCall("5", { type: "read", filePath: "/repo/a.ts" })],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const second = project({
      level: "overview",
      tail,
      head: [
        toolCall("5", { type: "read", filePath: "/repo/a.ts" }),
        toolCall("6", { type: "read", filePath: "/repo/b.ts" }),
      ],
      isTurnActive: true,
      preparedHistory: prepared,
    });

    expect(first.tail).toBe(prepared.grouped.tail);
    expect(second.tail).toBe(prepared.grouped.tail);
    expect(first.groupsByHostId.get("1")).toBe(prepared.grouped.groupsByHostId.get("1"));
    expect(second.groupsByHostId.get("1")).toBe(prepared.grouped.groupsByHostId.get("1"));
    expect(first.historyGroupUpdatesByHostId.size).toBe(0);
    expect(second.historyGroupUpdatesByHostId).toBe(first.historyGroupUpdatesByHostId);
    expect(second.groupsByHostId.get("5")?.run.calls).toHaveLength(2);
  });

  it("preserves projected history identity during assistant-only head updates", () => {
    const trailingCalls = [
      toolCall("1", { type: "shell", command: "one" }),
      toolCall("2", { type: "read", filePath: "/repo/a.ts" }),
    ];
    const tail = [assistant("before"), ...trailingCalls];
    const prepared = prepareToolCallHistory("overview", tail);
    if (!prepared) {
      throw new Error("Overview history must be prepared");
    }

    const firstHead = [assistant("answer")];
    const secondHead = [{ ...firstHead[0], text: "answer grows" }];
    const first = project({
      level: "overview",
      tail,
      head: firstHead,
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const second = project({
      level: "overview",
      tail,
      head: secondHead,
      isTurnActive: true,
      preparedHistory: prepared,
    });

    expect(first.tail).toBe(prepared.grouped.tail);
    expect(second.tail).toBe(prepared.grouped.tail);
    expect(first.groupsByHostId).toBe(prepared.grouped.groupsByHostId);
    expect(second.groupsByHostId).toBe(prepared.grouped.groupsByHostId);
    expect(first.historyGroupUpdatesByHostId.size).toBe(0);
    expect(second.historyGroupUpdatesByHostId).toBe(first.historyGroupUpdatesByHostId);
  });

  it("forms one group across the retained-history and live-head boundary", () => {
    const tail = [
      assistant("before"),
      toolCall("1", { type: "shell", command: "one" }),
      toolCall("2", { type: "shell", command: "two" }),
    ];
    const head = [
      toolCall("3", { type: "read", filePath: "/repo/a.ts" }),
      toolCall("4", { type: "edit", filePath: "/repo/a.ts" }, { status: "running" }),
    ];

    const result = project({ level: "overview", tail, head, isTurnActive: true });

    expect(result.tail).toEqual([
      tail[0],
      expect.objectContaining({ id: "1", timestamp: tail[2]?.timestamp }),
    ]);
    expect(result.head).toEqual([]);
    expect(result.groupsByHostId.get("1")?.run).toMatchObject({
      calls: [...tail.slice(1), ...head],
      latest: head[1],
      isSealed: false,
    });
    expect(result.historyGroupUpdatesByHostId.get("1")).toBe(result.groupsByHostId.get("1"));
  });

  it("keeps a trailing history-only group in the retained segment", () => {
    const tail = ["1", "2", "3", "4"].map((id) => toolCall(id, { type: "shell", command: id }));

    const result = project({ level: "overview", tail, isTurnActive: false });

    expect(result.tail).toEqual([
      expect.objectContaining({ id: "1", timestamp: tail[3]?.timestamp }),
    ]);
    expect(result.head).toEqual([]);
    expect(result.groupsByHostId.get("1")?.run.isSealed).toBe(true);
  });

  it("hosts single calls while leaving plans and spoken messages ungrouped", () => {
    const singleCall = toolCall("1", { type: "shell", command: "one" });
    const plan = toolCall("2", { type: "plan", text: "Plan" });
    const speak = toolCall(
      "3",
      { type: "unknown", input: "Hello", output: null },
      { name: "speak" },
    );

    const result = project({ level: "overview", head: [singleCall, plan, speak] });

    expect(result.head).toEqual([singleCall, plan, speak]);
    expect(result.groupsByHostId.get(singleCall.id)?.run.calls).toEqual([singleCall]);
    expect(result.groupsByHostId.size).toBe(1);
  });
});
