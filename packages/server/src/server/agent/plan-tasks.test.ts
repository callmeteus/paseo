import { describe, expect, test } from "vitest";
import { diffTimelineItem, markdownToTodo, planMarkdownToTodo } from "./plan-tasks.js";

describe("markdownToTodo", () => {
  test("turns each heading into a pending task", () => {
    expect(markdownToTodo("# Ler\n\n## Escrever\n")).toEqual({
      type: "todo",
      items: [
        { id: "0", text: "Ler", status: "pending", completed: false },
        { id: "1", text: "Escrever", status: "pending", completed: false },
      ],
    });
  });

  test("uses the first line when the plan has no heading", () => {
    expect(markdownToTodo("Um passo só.")).toEqual({
      type: "todo",
      items: [{ id: "0", text: "Um passo só.", status: "pending", completed: false }],
    });
  });
});

describe("planMarkdownToTodo", () => {
  test("splits a Codex bullet list into tasks", () => {
    expect(planMarkdownToTodo("- Ler\n- Escrever\n")).toEqual({
      type: "todo",
      items: [
        { id: "0", text: "Ler", status: "pending", completed: false },
        { id: "1", text: "Escrever", status: "pending", completed: false },
      ],
    });
  });
});

describe("diffTimelineItem", () => {
  test("keeps the patch and the branch names", () => {
    expect(
      diffTimelineItem({ patch: "diff --git", baseBranch: "main", headBranch: "agent" }),
    ).toEqual({
      type: "diff",
      patch: "diff --git",
      baseBranch: "main",
      headBranch: "agent",
    });
  });
});
