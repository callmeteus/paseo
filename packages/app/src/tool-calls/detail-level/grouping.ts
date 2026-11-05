import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { AssistantMessageItem, StreamItem, ThoughtItem, ToolCallItem } from "@/types/stream";
import { readProviderErrorText } from "@/agent-stream/provider-error";
import { isFoldableText } from "@/utils/foldable-text";

export interface ToolCallDescriptor {
  detail: ToolCallDetail;
  name: string;
  status: "executing" | "running" | "completed" | "failed" | "canceled";
  error: unknown;
  metadata?: Record<string, unknown>;
}

/** A step a group can hold: a tool call, a reasoning block, or a short line of narration. */
export type GroupableStep = ToolCallItem | ThoughtItem | AssistantMessageItem;

export interface GroupStepOptions {
  /** Reasoning keeps its own row when the reader asked to always expand it. */
  includeThought?: boolean;
  /** Short narration folds in only outside the streaming head. */
  includeShortText?: boolean;
}

export interface StepRun {
  id: string;
  /** Every step in the run, in order. */
  steps: readonly GroupableStep[];
  /**
   * Tool calls in the run, in order. Thoughts are excluded so the turn summary
   * keeps counting tools rather than blocks of reasoning.
   */
  calls: readonly ToolCallItem[];
  latest: GroupableStep;
  isSealed: boolean;
}

export interface GroupedHistory<TGroup> {
  tail: StreamItem[];
  groupsByHostId: Map<string, TGroup>;
  pendingSteps: readonly GroupableStep[];
}

export interface GroupedToolCalls<TGroup> {
  tail: StreamItem[];
  head: StreamItem[];
  groupsByHostId: ToolCallGroupLookup<TGroup>;
  historyGroupUpdatesByHostId: ToolCallGroupLookup<TGroup>;
}

export interface ToolCallGroupLookup<TGroup> {
  readonly size: number;
  get(id: string): TGroup | undefined;
  has(id: string): boolean;
}

const EMPTY_GROUPS = new Map<string, never>();

export function describeToolCall(item: ToolCallItem): ToolCallDescriptor {
  if (item.payload.source === "agent") {
    const { data } = item.payload;
    return {
      detail: data.detail,
      name: data.name,
      status: data.status,
      error: data.error,
      metadata: data.metadata,
    };
  }

  const { data } = item.payload;
  return {
    detail: {
      type: "unknown",
      input: data.arguments ?? null,
      output: data.result ?? null,
    },
    name: data.toolName,
    status: data.status,
    error: data.error,
  };
}

/**
 * Reasoning folds into the same run as the tool calls it explains, which is what
 * makes a stretch of agent work read as one line. Plan cards and speech stay out:
 * they are their own surfaces, not steps of work.
 */
export function isGroupableStep(
  item: StreamItem,
  options: GroupStepOptions = {},
): item is GroupableStep {
  if (item.kind === "thought") {
    return options.includeThought ?? true;
  }
  if (item.kind === "assistant_message") {
    // A failure sentence is not narration: folding it would hide an error inside a group.
    return (
      (options.includeShortText ?? false) &&
      isFoldableText(item.text) &&
      readProviderErrorText(item.text) === null
    );
  }
  if (item.kind !== "tool_call") {
    return false;
  }
  const descriptor = describeToolCall(item);
  return descriptor.detail.type !== "plan" && descriptor.name.trim().toLowerCase() !== "speak";
}

function createRun(steps: readonly GroupableStep[], isSealed: boolean): StepRun {
  const first = steps[0];
  const latest = steps.at(-1);
  if (!first || !latest) {
    throw new Error("Cannot group an empty step run");
  }
  return {
    id: first.id,
    steps,
    calls: steps.filter((step): step is ToolCallItem => step.kind === "tool_call"),
    latest,
    isSealed,
  };
}

function createHost(run: StepRun): StreamItem {
  if (run.steps.length === 1) {
    return run.latest;
  }
  // Anchor on the last tool call so a run that ends in narration keeps the badge's
  // tool-sequence spacing, and a run of tools alone keeps its old host shape.
  const anchor = run.calls.at(-1) ?? run.latest;
  return retagStep(anchor, run.id);
}

function retagStep(step: GroupableStep, id: string): StreamItem {
  switch (step.kind) {
    case "tool_call":
      return { ...step, id };
    case "thought":
      return { ...step, id };
    case "assistant_message":
      return { ...step, id };
  }
}

/** A stretch of narration alone is not a group; it would read as a label with no work. */
function formsGroup(steps: readonly GroupableStep[]): boolean {
  return steps.some((step) => step.kind !== "assistant_message");
}

function isRunningStep(step: GroupableStep): boolean {
  if (step.kind === "thought") {
    return step.status === "loading";
  }
  if (step.kind === "assistant_message") {
    return false;
  }
  const status = describeToolCall(step).status;
  return status === "running" || status === "executing";
}

function appendRun<TGroup>(input: {
  steps: readonly GroupableStep[];
  isSealed: boolean;
  output: StreamItem[];
  groups: Map<string, TGroup>;
  buildGroup: (run: StepRun) => TGroup;
}): void {
  if (input.steps.length === 0) {
    return;
  }
  if (!formsGroup(input.steps)) {
    input.output.push(...input.steps);
    return;
  }
  const run = createRun(input.steps, input.isSealed);
  const host = createHost(run);
  input.output.push(host);
  input.groups.set(host.id, input.buildGroup(run));
}

export function prepareGroupedHistory<TGroup>(input: {
  tail: StreamItem[];
  buildGroup: (run: StepRun) => TGroup;
  includeThought?: boolean;
  includeShortText?: boolean;
}): GroupedHistory<TGroup> {
  const output: StreamItem[] = [];
  const groups = new Map<string, TGroup>();
  const options: GroupStepOptions = {
    includeThought: input.includeThought ?? true,
    includeShortText: input.includeShortText ?? false,
  };
  const lastIndex = input.tail.length - 1;
  let pending: GroupableStep[] = [];

  for (let index = 0; index < input.tail.length; index += 1) {
    const item = input.tail[index];
    if (item === undefined) {
      continue;
    }
    // The final message of a finished turn is the agent's answer. Folding it would hide
    // the reply behind a collapsed row.
    const isFinalAnswer = index === lastIndex && item.kind === "assistant_message";
    if (!isFinalAnswer && isGroupableStep(item, options)) {
      pending.push(item);
      continue;
    }
    appendRun({
      steps: pending,
      isSealed: true,
      output,
      groups,
      buildGroup: input.buildGroup,
    });
    pending = [];
    output.push(item);
  }

  appendRun({
    steps: pending,
    isSealed: true,
    output,
    groups,
    buildGroup: input.buildGroup,
  });

  return {
    tail: groups.size > 0 ? output : input.tail,
    groupsByHostId: groups,
    // Narration alone is emitted as plain rows, so it must not stay pending and get
    // folded into a live run later.
    pendingSteps: formsGroup(pending) ? pending : [],
  };
}

export function groupLiveToolCalls<TGroup>(input: {
  history: GroupedHistory<TGroup>;
  head: StreamItem[];
  isTurnActive: boolean;
  buildGroup: (run: StepRun) => TGroup;
  includeThought?: boolean;
}): GroupedToolCalls<TGroup> {
  const head: StreamItem[] = [];
  const includeThought = input.includeThought ?? true;
  // Text still streaming must stay visible: folding it would make the agent's reply
  // disappear until the group is opened.
  const headOptions: GroupStepOptions = { includeThought, includeShortText: false };
  const liveGroups = new Map<string, TGroup>();
  let pending = [...input.history.pendingSteps];
  let hostPlacement: "history" | "head" | null = pending.length > 0 ? "history" : null;
  let pendingIncludesHead = false;

  const flush = (isSealed: boolean) => {
    if (pending.length === 0) {
      return;
    }
    const steps = pending;
    const placement = hostPlacement;
    const includesHead = pendingIncludesHead;
    pending = [];
    hostPlacement = null;
    pendingIncludesHead = false;
    if (!formsGroup(steps)) {
      if (placement === "head") {
        head.push(...steps);
      }
      return;
    }
    const run = createRun(steps, isSealed);
    if (placement === "head") {
      head.push(createHost(run));
    }
    if (placement === "head" || includesHead || !isSealed) {
      liveGroups.set(run.id, input.buildGroup(run));
    }
  };

  for (const item of input.head) {
    if (isGroupableStep(item, headOptions)) {
      if (pending.length === 0) {
        hostPlacement = "head";
      }
      pending.push(item);
      pendingIncludesHead = true;
      continue;
    }
    flush(true);
    head.push(item);
  }
  // Tool calls live in retained tail rather than the streaming head. The agent
  // lifecycle snapshot can still be idle while a newly received tool call is
  // already running, so its direct timeline status is the authoritative start
  // signal. The lifecycle state continues to keep completed calls live between
  // sequential tool updates.
  const trailingRunIsActive = input.isTurnActive || pending.some(isRunningStep);
  flush(!trailingRunIsActive);

  if (liveGroups.size === 0) {
    return {
      tail: input.history.tail,
      head: input.head,
      groupsByHostId: input.history.groupsByHostId,
      historyGroupUpdatesByHostId: EMPTY_GROUPS,
    };
  }
  if (input.history.groupsByHostId.size === 0) {
    return {
      tail: input.history.tail,
      head,
      groupsByHostId: liveGroups,
      historyGroupUpdatesByHostId: EMPTY_GROUPS,
    };
  }
  const groupsByHostId = new Map(input.history.groupsByHostId);
  let historyGroupUpdatesByHostId: Map<string, TGroup> | null = null;
  for (const [id, group] of liveGroups) {
    groupsByHostId.set(id, group);
    if (input.history.groupsByHostId.has(id)) {
      historyGroupUpdatesByHostId ??= new Map();
      historyGroupUpdatesByHostId.set(id, group);
    }
  }
  return {
    tail: input.history.tail,
    head,
    groupsByHostId,
    historyGroupUpdatesByHostId: historyGroupUpdatesByHostId ?? EMPTY_GROUPS,
  };
}
