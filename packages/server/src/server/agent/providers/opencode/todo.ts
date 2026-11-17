import type { AgentTimelineItem } from "../../agent-sdk-types.js";

export interface OpencodeTodo {
  content?: string | null;
  status?: string | null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function isOpencodeTodoWriteToolName(name: string): boolean {
  return name.trim().toLowerCase() === "todowrite";
}

export function readOpencodeTodoItems(value: unknown): OpencodeTodo[] | null {
  if (typeof value === "string") {
    try {
      return readOpencodeTodoItems(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const record = readRecord(entry);
      if (!record) return [];
      const content = readNonEmptyString(record.content);
      if (!content) return [];
      return [{ content, status: readNonEmptyString(record.status) }];
    });
  }
  const record = readRecord(value);
  if (!record) return null;
  return readOpencodeTodoItems(record.todos);
}

function normalizeTodoStatus(status?: string | null) {
  if (status === "completed") return "completed" as const;
  if (status === "in_progress" || status === "inProgress") return "in_progress" as const;
  return "pending" as const;
}

export function mapOpencodeTodosToTimelineItem(
  todos: OpencodeTodo[],
): Extract<AgentTimelineItem, { type: "todo" }> {
  return {
    type: "todo",
    items: todos.flatMap((todo) => {
      const text = readNonEmptyString(todo.content);
      if (!text) return [];
      return [
        {
          text,
          status: normalizeTodoStatus(todo.status),
          completed: todo.status === "completed",
        },
      ];
    }),
  };
}
