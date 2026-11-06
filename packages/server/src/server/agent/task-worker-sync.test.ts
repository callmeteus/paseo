import { describe, expect, it } from "vitest";

import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { ProviderSubagentStore } from "./provider-subagents/store.js";
import { syncTaskWorkers } from "./task-worker-sync.js";

const DESCRIPTION = "Por que não compactou o contexto";
const PROMPT = "Answer why OpenCode did not compact the context";

function taskCall(
  status: "running" | "completed" | "failed",
  output: unknown = null,
  error: unknown = null,
): AgentTimelineItem {
  const detail = {
    type: "unknown" as const,
    input: {
      _toolName: "task",
      prompt: PROMPT,
      description: DESCRIPTION,
    },
    output,
  };
  if (status === "failed") {
    return { type: "tool_call", callId: "call-1", name: "other", status, error, detail };
  }
  return { type: "tool_call", callId: "call-1", name: "other", status, error: null, detail };
}

function sync(store: ProviderSubagentStore, items: readonly AgentTimelineItem[]) {
  return syncTaskWorkers({
    parentAgentId: "parent",
    provider: "cursor",
    items,
    store,
  });
}

function childTexts(store: ProviderSubagentStore) {
  return store.fetchTimeline("parent", "task:call-1").rows.map((row) => row.item);
}

describe("syncTaskWorkers", () => {
  it("registers a running task under its description and seeds the prompt once", () => {
    const store = new ProviderSubagentStore();
    const first = sync(store, [
      taskCall("running"),
      {
        type: "tool_call",
        callId: "shell-1",
        name: "execute",
        status: "completed",
        error: null,
        detail: { type: "shell", command: "ls" },
      },
    ]);

    expect(store.list("parent")).toEqual([
      expect.objectContaining({
        id: "task:call-1",
        description: DESCRIPTION,
        title: null,
        status: "running",
        toolCallId: "call-1",
        provider: "cursor",
      }),
    ]);
    expect(childTexts(store)).toEqual([{ type: "user_message", text: PROMPT }]);
    expect(first.map((event) => event.type)).toEqual(["upsert", "timeline"]);
    expect(sync(store, [taskCall("running")])).toEqual([]);
    expect(childTexts(store)).toHaveLength(1);
  });

  it("seeds the prompt and the result together when the task is already finished", () => {
    const store = new ProviderSubagentStore();
    sync(store, [taskCall("completed", "The proxy cut the window.")]);

    expect(store.get("parent", "task:call-1")?.status).toBe("completed");
    expect(childTexts(store)).toEqual([
      { type: "user_message", text: PROMPT },
      {
        type: "assistant_message",
        text: "The proxy cut the window.",
        messageId: "task-output:call-1",
      },
    ]);
    expect(sync(store, [taskCall("completed", "The proxy cut the window.")])).toEqual([]);
  });

  it("moves a running task to completed and records the result once", () => {
    const store = new ProviderSubagentStore();
    sync(store, [taskCall("running")]);
    sync(store, [taskCall("completed", "The proxy cut the window.")]);

    expect(store.get("parent", "task:call-1")?.status).toBe("completed");
    expect(childTexts(store)).toEqual([
      { type: "user_message", text: PROMPT },
      {
        type: "assistant_message",
        text: "The proxy cut the window.",
        messageId: "task-output:call-1",
      },
    ]);
    expect(sync(store, [taskCall("completed", "The proxy cut the window.")])).toEqual([]);
    expect(childTexts(store)).toHaveLength(2);
  });

  it("marks a failed task and uses the real error as its subtitle", () => {
    const store = new ProviderSubagentStore();
    sync(store, [taskCall("failed", null, { message: "the proxy closed the stream" })]);

    expect(store.get("parent", "task:call-1")).toMatchObject({
      description: DESCRIPTION,
      status: "failed",
      subtitle: "the proxy closed the stream",
    });
    expect(childTexts(store)).toEqual([
      { type: "user_message", text: PROMPT },
      {
        type: "assistant_message",
        text: "the proxy closed the stream",
        messageId: "task-output:call-1",
      },
    ]);
  });

  it("does not register an OpenCode sub-agent task or a tool named other", () => {
    const store = new ProviderSubagentStore();
    sync(store, [
      {
        type: "tool_call",
        callId: "explore",
        name: "task",
        status: "running",
        error: null,
        detail: {
          type: "sub_agent",
          subAgentType: "Explore",
          description: "Inspect repository structure",
          log: "",
        },
      },
      {
        type: "tool_call",
        callId: "plain",
        name: "other",
        status: "completed",
        error: null,
        detail: { type: "unknown", input: { command: "ls" }, output: null },
      },
    ]);

    expect(store.list("parent")).toEqual([]);
  });
});
