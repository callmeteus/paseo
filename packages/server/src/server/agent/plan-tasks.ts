import type { AgentTimelineItem } from "./agent-sdk-types.js";

/**
 * One Slack-ready task list from a markdown plan.
 *
 * A checkbox list wins: plan mode requires one, and its checked state is how the
 * task list tracks progress. Otherwise a heading becomes a task. A plan with
 * neither becomes a single task, so the Hub mirror still has something to show.
 */
export function markdownToTodo(text: string): Extract<AgentTimelineItem, { type: "todo" }> {
  const checklist = checklistItems(text);
  if (checklist.length > 0) return checklistTodo(checklist);
  const tasks = headings(text);
  return todo(tasks.length > 0 ? tasks : [firstLine(text)]);
}

/** True when the plan carries the checklist plan mode requires. */
export function hasPlanChecklist(text: string): boolean {
  return checklistItems(text).length > 0;
}

interface ChecklistItem {
  text: string;
  completed: boolean;
}

function checklistItems(text: string): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  for (const line of text.split("\n")) {
    const match = /^[-*+]\s+\[(?: |x|X)\]\s+(.+)$/u.exec(line.trim());
    const label = match?.[1]?.trim() ?? "";
    if (!match || label.length === 0) continue;
    items.push({ text: label, completed: match[0].includes("[x]") || match[0].includes("[X]") });
  }
  return items;
}

/**
 * The first unchecked item of a started checklist is the step being worked on.
 * A checklist nobody started yet stays entirely pending: the plan is still being
 * presented, not executed.
 */
function checklistTodo(
  items: readonly ChecklistItem[],
): Extract<AgentTimelineItem, { type: "todo" }> {
  const started = items.some((item) => item.completed);
  const activeIndex = items.findIndex((item) => !item.completed);
  return {
    type: "todo",
    items: items.map((item, index) => {
      let status: "pending" | "in_progress" | "completed" = "pending";
      if (item.completed) status = "completed";
      else if (started && index === activeIndex) status = "in_progress";
      return { id: String(index), text: item.text, status, completed: item.completed };
    }),
  };
}

function headings(text: string): string[] {
  return text
    .split("\n")
    .map((line) => /^#{1,6}\s+(.+)$/u.exec(line.trim())?.[1]?.trim() ?? "")
    .filter((line) => line.length > 0);
}

function todo(tasks: readonly string[]): Extract<AgentTimelineItem, { type: "todo" }> {
  return {
    type: "todo",
    items: tasks.map((task, index) => ({
      id: String(index),
      text: task,
      status: "pending" as const,
      completed: false,
    })),
  };
}

/**
 * A Codex plan item is a bullet list, not a heading list.
 * Headings still win when the text has them.
 */
export function planMarkdownToTodo(text: string): Extract<AgentTimelineItem, { type: "todo" }> {
  if (hasPlanChecklist(text) || headings(text).length > 0) return markdownToTodo(text);
  const bullets = text
    .split("\n")
    .map((line) => /^[-*+]\s+(.+)$/u.exec(line.trim())?.[1]?.trim() ?? "")
    .filter((line) => line.length > 0);
  if (bullets.length === 0) return markdownToTodo(text);
  return todo(bullets);
}

export function diffTimelineItem(input: {
  patch: string;
  baseBranch?: string | undefined;
  headBranch?: string | undefined;
}): Extract<AgentTimelineItem, { type: "diff" }> {
  return {
    type: "diff",
    patch: input.patch,
    ...(input.baseBranch === undefined ? {} : { baseBranch: input.baseBranch }),
    ...(input.headBranch === undefined ? {} : { headBranch: input.headBranch }),
  };
}

function firstLine(text: string): string {
  const line = text
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  return line === undefined || line.length === 0 ? "Plan" : line;
}
