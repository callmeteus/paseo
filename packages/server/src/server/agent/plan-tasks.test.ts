import { describe, expect, test } from "vitest";
import {
  diffTimelineItem,
  hasPlanChecklist,
  markdownToTodo,
  planMarkdownToTodo,
} from "./plan-tasks.js";

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

  test("prefers the checklist and keeps its progress", () => {
    expect(
      markdownToTodo("# Plano\n\n- [x] Ler\n- [X] Escrever\n- [ ] Testar\n- [ ] Enviar\n"),
    ).toEqual({
      type: "todo",
      items: [
        { id: "0", text: "Ler", status: "completed", completed: true },
        { id: "1", text: "Escrever", status: "completed", completed: true },
        { id: "2", text: "Testar", status: "in_progress", completed: false },
        { id: "3", text: "Enviar", status: "pending", completed: false },
      ],
    });
  });

  test("leaves a checklist nobody started as pending", () => {
    expect(markdownToTodo("- [ ] Ler\n- [ ] Escrever\n")).toEqual({
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

describe("hasPlanChecklist", () => {
  test("accepts checked and unchecked items in any bullet marker", () => {
    expect(hasPlanChecklist("- [ ] Ler")).toBe(true);
    expect(hasPlanChecklist("* [x] Ler")).toBe(true);
    expect(hasPlanChecklist("+ [X] Ler")).toBe(true);
  });

  test("rejects a plan without checkboxes", () => {
    expect(hasPlanChecklist("# Plano\n\n1. Ler\n2. Escrever")).toBe(false);
    expect(hasPlanChecklist("- Ler\n- Escrever")).toBe(false);
    expect(hasPlanChecklist("- [] Ler")).toBe(false);
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

  test("keeps checklist progress when the plan is a checkbox list", () => {
    expect(planMarkdownToTodo("- [x] Ler\n- [ ] Escrever\n")).toEqual({
      type: "todo",
      items: [
        { id: "0", text: "Ler", status: "completed", completed: true },
        { id: "1", text: "Escrever", status: "in_progress", completed: false },
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
