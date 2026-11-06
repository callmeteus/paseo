/**
 * A provider `task` tool call that belongs on the subagent track.
 *
 * Cursor reports that tool as kind `other` and puts `_toolName`, `prompt`, and
 * `description` in the raw input. The description is the row title. The prompt
 * stays available on the child, and is never the label.
 */
export interface TaskWorkerCall {
  toolCallId: string;
  description: string;
  prompt: string | null;
  subAgentType: string | null;
  outputText: string | null;
  errorText: string | null;
}

/** The tool-call fields the reader needs. Both protocol and server timeline items satisfy this. */
export interface TaskWorkerToolCall {
  callId: string;
  name: string;
  detail: unknown;
  error?: unknown;
}

const TASK_WORKER_ID_PREFIX = "task:";

/** ACP's mapper uses this sentence when a failed tool has no error text. It is not a subtitle. */
const TOOL_FAILURE_FALLBACK = "Tool call failed";

/**
 * Stable id for the provider-subagent row of one task tool call.
 *
 * @param toolCallId - The parent timeline's tool call id
 */
export function taskWorkerSubagentId(toolCallId: string): string {
  return `${TASK_WORKER_ID_PREFIX}${toolCallId}`;
}

/**
 * Whether this provider-subagent id was minted for a task tool call.
 *
 * @param id - Provider subagent id
 */
export function isTaskWorkerSubagentId(id: string): boolean {
  return id.startsWith(TASK_WORKER_ID_PREFIX);
}

/**
 * Provider-subagent status for a timeline tool status.
 *
 * Completed, failed, and canceled pass through. Everything still in flight is running.
 *
 * @param status - Timeline tool status, or a provider status string
 */
export function taskWorkerStatus(status: string): "running" | "completed" | "failed" | "canceled" {
  if (status === "completed" || status === "failed" || status === "canceled") {
    return status;
  }
  return "running";
}

/**
 * Reads a task tool call out of an unknown detail.
 *
 * OpenCode (and OMP) already emit `sub_agent` details and their own subagent rows.
 * Those return null so this path does not rename or hide them. A task with no
 * description also returns null: the prompt is not a title.
 *
 * @param input - One timeline tool call
 * @returns The worker facts, or null when this call is not a task worker
 */
export function readTaskWorkerCall(input: TaskWorkerToolCall): TaskWorkerCall | null {
  const detail = readRecord(input.detail);
  if (!detail || detail.type !== "unknown") {
    return null;
  }

  const rawInput = readInput(detail.input);
  const timelineName = normalizeName(input.name);
  const embeddedName = rawInput
    ? normalizeName(rawInput._toolName ?? rawInput.toolName ?? rawInput.tool_name)
    : null;
  const namedTask = timelineName === "task" || embeddedName === "task";
  if (!namedTask) {
    return null;
  }

  const description = readText(rawInput?.description);
  if (!description) {
    return null;
  }

  return {
    toolCallId: input.callId,
    description,
    prompt: readText(rawInput?.prompt),
    subAgentType: readSubAgentType(rawInput),
    outputText: readOutputText(detail.output),
    errorText: readErrorText(input.error),
  };
}

function readSubAgentType(rawInput: Record<string, unknown> | null): string | null {
  if (!rawInput) {
    return null;
  }
  return (
    readText(rawInput.subagent_type) ??
    readText(rawInput.subAgentType) ??
    readText(rawInput.agent_type) ??
    readText(rawInput.agent)
  );
}

function readInput(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{")) {
      return null;
    }
    try {
      return readRecord(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  return readRecord(value);
}

function readOutputText(output: unknown): string | null {
  const direct = readText(output);
  if (direct) {
    return direct;
  }
  const record = readRecord(output);
  if (!record) {
    return null;
  }
  return (
    readText(record.text) ??
    readText(record.output) ??
    readText(record.content) ??
    readText(record.result) ??
    readText(record.message)
  );
}

function readErrorText(error: unknown): string | null {
  const direct = readText(error);
  if (direct) {
    return meaningfulError(direct);
  }
  const record = readRecord(error);
  if (!record) {
    return null;
  }
  return meaningfulError(
    readText(record.message) ?? readText(record.error) ?? readText(record.content),
  );
}

function meaningfulError(text: string | null): string | null {
  if (!text || text === TOOL_FAILURE_FALLBACK) {
    return null;
  }
  return text;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeName(value: unknown): string | null {
  const text = readText(value);
  return text ? text.toLowerCase() : null;
}
