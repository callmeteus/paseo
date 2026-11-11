import type { AgentTimelineItem } from "./agent-sdk-types.js";

/**
 * One Slack-ready task list from a markdown plan.
 *
 * A heading becomes a task. A plan with no heading becomes a single task,
 * so the Hub mirror still has something to show.
 */
export function markdownToTodo(text: string): Extract<AgentTimelineItem, { type: "todo" }> {
  const tasks = headings(text);
  return todo(tasks.length > 0 ? tasks : [firstLine(text)]);
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
  if (headings(text).length > 0) return markdownToTodo(text);
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
