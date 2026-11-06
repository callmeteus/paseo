import {
  isTaskWorkerSubagentId,
  readTaskWorkerCall,
  taskWorkerStatus,
  taskWorkerSubagentId,
} from "@getpaseo/protocol/task-worker";
import type { AgentProvider, AgentTimelineItem } from "./agent-sdk-types.js";
import type {
  ProviderSubagentStatus,
  ProviderSubagentStore,
  ProviderSubagentStoreEvent,
} from "./provider-subagents/store.js";

interface FoldedTaskWorker {
  id: string;
  toolCallId: string;
  description: string;
  subAgentType: string | null;
  prompt: string | null;
  outputText: string | null;
  errorText: string | null;
  status: ProviderSubagentStatus;
}

interface TaskWorkerSnapshot {
  status: ProviderSubagentStatus;
  userTexts: readonly string[];
  hasAssistantMessage: boolean;
}

/**
 * One change the subagent store still needs for a task worker.
 *
 * `upsert` is false when the row is already at this status. The seeds are null
 * once that text is already on the child timeline, so applying the plan twice
 * does not repeat the prompt.
 */
export interface PlannedTaskWorker {
  id: string;
  description: string;
  title: string | null;
  status: ProviderSubagentStatus;
  toolCallId: string;
  subtitle?: string;
  upsert: boolean;
  seedPrompt: string | null;
  seedOutput: string | null;
}

/**
 * Folds task tool calls into the provider-subagent updates the track reads.
 *
 * The last status wins. The first prompt is kept. Output is seeded only when
 * the call has finished, and a failed call uses its real error text rather than
 * the generic "Tool call failed" fallback.
 *
 * @param input - Parent timeline items and the task rows already stored
 */
export function planTaskWorkers(input: {
  items: readonly AgentTimelineItem[];
  existing: ReadonlyMap<string, TaskWorkerSnapshot>;
}): PlannedTaskWorker[] {
  const planned: PlannedTaskWorker[] = [];
  for (const worker of foldTaskWorkers(input.items).values()) {
    const current = input.existing.get(worker.id);
    const subtitle = worker.status === "failed" && worker.errorText ? worker.errorText : undefined;
    const output = terminalOutput(worker);
    const upsert = !current || current.status !== worker.status;
    const seedPrompt =
      worker.prompt && !current?.userTexts.includes(worker.prompt) ? worker.prompt : null;
    const seedOutput = output && !current?.hasAssistantMessage ? output : null;
    if (!upsert && !seedPrompt && !seedOutput) {
      continue;
    }
    planned.push({
      id: worker.id,
      description: worker.description,
      title: worker.subAgentType,
      status: worker.status,
      toolCallId: worker.toolCallId,
      ...(subtitle ? { subtitle } : {}),
      upsert,
      seedPrompt,
      seedOutput,
    });
  }
  return planned;
}

/**
 * Writes task workers into the provider-subagent store the composer track lists.
 *
 * @param input - Parent chat, its provider, the timeline, and the store the UI reads
 * @returns Store events to broadcast. Empty when nothing changed.
 */
export function syncTaskWorkers(input: {
  parentAgentId: string;
  provider: AgentProvider;
  items: readonly AgentTimelineItem[];
  store: ProviderSubagentStore;
}): ProviderSubagentStoreEvent[] {
  const existing = new Map<string, TaskWorkerSnapshot>();
  for (const subagent of input.store.list(input.parentAgentId)) {
    if (!isTaskWorkerSubagentId(subagent.id)) {
      continue;
    }
    const timeline = input.store.fetchTimeline(input.parentAgentId, subagent.id);
    const userTexts: string[] = [];
    let hasAssistantMessage = false;
    for (const row of timeline.rows) {
      if (row.item.type === "user_message") {
        userTexts.push(row.item.text);
      }
      if (row.item.type === "assistant_message") {
        hasAssistantMessage = true;
      }
    }
    existing.set(subagent.id, {
      status: subagent.status,
      userTexts,
      hasAssistantMessage,
    });
  }

  const events: ProviderSubagentStoreEvent[] = [];
  for (const worker of planTaskWorkers({ items: input.items, existing })) {
    if (worker.upsert) {
      events.push(
        input.store.apply(input.parentAgentId, input.provider, {
          type: "upsert",
          id: worker.id,
          description: worker.description,
          status: worker.status,
          toolCallId: worker.toolCallId,
          ...(worker.title ? { title: worker.title } : {}),
          ...(worker.subtitle ? { subtitle: worker.subtitle } : {}),
        }),
      );
    }
    if (worker.seedPrompt && !childHasPrompt(input, worker.id, worker.seedPrompt)) {
      events.push(
        input.store.apply(input.parentAgentId, input.provider, {
          type: "timeline",
          id: worker.id,
          item: { type: "user_message", text: worker.seedPrompt },
        }),
      );
    }
    if (worker.seedOutput && !childHasAssistantMessage(input, worker.id)) {
      events.push(
        input.store.apply(input.parentAgentId, input.provider, {
          type: "timeline",
          id: worker.id,
          item: {
            type: "assistant_message",
            text: worker.seedOutput,
            messageId: `task-output:${worker.toolCallId}`,
          },
        }),
      );
    }
  }
  return events;
}

function childHasPrompt(
  input: { parentAgentId: string; store: ProviderSubagentStore },
  subagentId: string,
  prompt: string,
): boolean {
  return input.store
    .fetchTimeline(input.parentAgentId, subagentId)
    .rows.some((row) => row.item.type === "user_message" && row.item.text === prompt);
}

function childHasAssistantMessage(
  input: { parentAgentId: string; store: ProviderSubagentStore },
  subagentId: string,
): boolean {
  return input.store
    .fetchTimeline(input.parentAgentId, subagentId)
    .rows.some((row) => row.item.type === "assistant_message");
}

function foldTaskWorkers(items: readonly AgentTimelineItem[]): Map<string, FoldedTaskWorker> {
  const folded = new Map<string, FoldedTaskWorker>();
  for (const item of items) {
    if (item.type !== "tool_call") {
      continue;
    }
    const facts = readTaskWorkerCall({
      callId: item.callId,
      name: item.name,
      detail: item.detail,
      error: item.status === "failed" ? item.error : null,
    });
    if (!facts) {
      continue;
    }
    const id = taskWorkerSubagentId(facts.toolCallId);
    const previous = folded.get(id);
    folded.set(id, {
      id,
      toolCallId: facts.toolCallId,
      description: previous?.description ?? facts.description,
      subAgentType: facts.subAgentType ?? previous?.subAgentType ?? null,
      prompt: previous?.prompt ?? facts.prompt,
      outputText: facts.outputText ?? previous?.outputText ?? null,
      errorText: facts.errorText ?? previous?.errorText ?? null,
      status: taskWorkerStatus(item.status),
    });
  }
  return folded;
}

function terminalOutput(worker: FoldedTaskWorker): string | null {
  if (worker.status === "failed") {
    return worker.errorText ?? worker.outputText;
  }
  if (worker.status === "completed") {
    return worker.outputText;
  }
  return null;
}
