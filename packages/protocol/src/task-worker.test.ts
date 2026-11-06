import { describe, expect, it } from "vitest";

import { buildToolCallDisplayModel } from "./tool-call-display.js";
import { readTaskWorkerCall, taskWorkerStatus, taskWorkerSubagentId } from "./task-worker.js";

const DESCRIPTION = "Por que não compactou o contexto";
const PROMPT = "Answer why OpenCode did not compact the context";

function cursorTask(status: "running" | "completed" | "failed" = "running") {
  return {
    callId: "call-1",
    name: "other",
    detail: {
      type: "unknown",
      input: {
        _toolName: "task",
        prompt: PROMPT,
        description: DESCRIPTION,
      },
      output: null,
    },
    error: status === "failed" ? { message: "the proxy closed the stream" } : null,
  };
}

describe("readTaskWorkerCall", () => {
  it("titles a Cursor task by its description and keeps the prompt off the label", () => {
    const facts = readTaskWorkerCall(cursorTask());

    expect(facts).toEqual({
      toolCallId: "call-1",
      description: DESCRIPTION,
      prompt: PROMPT,
      subAgentType: null,
      outputText: null,
      errorText: null,
    });
    expect(facts?.description).not.toBe("Other");
    expect(facts?.description).not.toBe(PROMPT);
    expect(taskWorkerSubagentId(facts?.toolCallId ?? "")).toBe("task:call-1");
    expect(taskWorkerStatus("running")).toBe("running");
    expect(taskWorkerStatus("in_progress")).toBe("running");
    expect(taskWorkerStatus("completed")).toBe("completed");
    expect(taskWorkerStatus("failed")).toBe("failed");
  });

  it("reads a JSON string input and a real failure", () => {
    const facts = readTaskWorkerCall({
      callId: "call-2",
      name: "other",
      detail: {
        type: "unknown",
        input: JSON.stringify({
          _toolName: "Task",
          description: DESCRIPTION,
          prompt: PROMPT,
          subagent_type: "general-purpose",
        }),
        output: { text: "The proxy cut the window." },
      },
      error: { message: "the proxy closed the stream" },
    });

    expect(facts).toMatchObject({
      description: DESCRIPTION,
      prompt: PROMPT,
      subAgentType: "general-purpose",
      outputText: "The proxy cut the window.",
      errorText: "the proxy closed the stream",
    });
    expect(taskWorkerStatus("failed")).toBe("failed");
  });

  it("ignores the generic tool-failure fallback", () => {
    expect(
      readTaskWorkerCall({
        ...cursorTask("failed"),
        error: { message: "Tool call failed" },
      })?.errorText,
    ).toBeNull();
  });

  it("leaves a plain other tool and a task with no description alone", () => {
    expect(
      readTaskWorkerCall({
        callId: "plain",
        name: "other",
        detail: { type: "unknown", input: { command: "ls" }, output: null },
      }),
    ).toBeNull();
    expect(
      readTaskWorkerCall({
        callId: "no-title",
        name: "other",
        detail: {
          type: "unknown",
          input: { _toolName: "task", prompt: PROMPT },
          output: null,
        },
      }),
    ).toBeNull();
  });

  it("does not treat an OpenCode sub-agent task as this worker", () => {
    expect(
      readTaskWorkerCall({
        callId: "explore",
        name: "task",
        detail: {
          type: "sub_agent",
          subAgentType: "Explore",
          description: "Inspect repository structure",
          log: "",
        },
      }),
    ).toBeNull();
  });
});

describe("task worker display", () => {
  it("uses the description as the display name instead of Other", () => {
    const display = buildToolCallDisplayModel({
      name: "other",
      status: "running",
      error: null,
      detail: cursorTask().detail,
    });

    expect(display).toEqual({ displayName: DESCRIPTION });
    expect(display.displayName).not.toBe("Other");
    expect(display.summary).toBeUndefined();
  });

  it("keeps an OpenCode sub-agent task labeled by its type", () => {
    const display = buildToolCallDisplayModel({
      name: "task",
      status: "running",
      error: null,
      detail: {
        type: "sub_agent",
        subAgentType: "Explore",
        description: "Inspect repository structure",
        log: "[Read] README.md",
      },
    });

    expect(display).toEqual({
      displayName: "Explore",
      summary: "Inspect repository structure",
    });
  });
});
