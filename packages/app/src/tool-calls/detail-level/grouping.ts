import { isTurnTrigger, isTurnBoundary } from "@/agent-stream/turn-membership";
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

/** Tool calls and reasoning, without narration. Kept for the upstream-facing helpers. */
export type GroupableItem = ToolCallItem | ThoughtItem;

export interface GroupStepOptions {
  /** Reasoning keeps its own row when the reader asked to always expand it. */
  includeThought?: boolean;
  /** Short narration folds in only outside the streaming head. */
  includeShortText?: boolean;
  /** Upstream switch: reasoning keeps its own row when the reader expanded it. */
  autoExpandReasoning?: boolean;
}

export interface StepRun {
  id: string;
  /** Every step in the run, in order, including short narration. */
  steps: readonly GroupableStep[];
  /** Tool calls and reasoning in the run, in order. Narration is excluded. */
  calls: readonly GroupableItem[];
  /** Tool calls only, so a turn summary can keep counting tools. */
  toolCalls: readonly ToolCallItem[];
  latest: GroupableStep;
  isSealed: boolean;
}

/** Upstream name for a run. The run keeps `steps`, `calls` and tool-only `toolCalls`. */
export type ToolCallRun = StepRun;

export interface GroupedHistory<TGroup> {
  tail: StreamItem[];
  groupsByHostId: Map<string, TGroup>;
  pendingSteps: readonly GroupableStep[];
  /** Upstream view of the pending steps, without narration. */
  pendingCalls: readonly GroupableItem[];
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
 * makes a stretch of agent work read as one line. Plan cards, speech and turn
 * triggers stay out: they are their own surfaces, not steps of work.
 */
export function isGroupableStep(
  item: StreamItem,
  options: GroupStepOptions = {},
): item is GroupableStep {
  if (item.kind === "thought") {
    return (options.includeThought ?? true) && !(options.autoExpandReasoning ?? false);
  }
  if (item.kind === "assistant_message") {
    // A failure sentence is not narration: folding it would hide an error inside a group.
    return (
      (options.includeShortText ?? false) &&
      isFoldableText(item.text) &&
      readProviderErrorText(item.text) === null
    );
  }
  if (item.kind !== "tool_call" || isTurnTrigger(item)) {
    return false;
  }
  const descriptor = describeToolCall(item);
  return descriptor.detail.type !== "plan" && descriptor.name.trim().toLowerCase() !== "speak";
}

/** Upstream-facing predicate, expressed in terms of our step grouping. */
export function isGroupableToolCall(
  item: StreamItem,
  autoExpandReasoning = false,
): item is GroupableItem {
  return (
    item.kind !== "assistant_message" &&
    isGroupableStep(item, {
      includeThought: !autoExpandReasoning,
      includeShortText: false,
      autoExpandReasoning,
    })
  );
}

function resolveOptions(input: {
  includeThought?: boolean;
  includeShortText?: boolean;
  autoExpandReasoning?: boolean;
}): GroupStepOptions {
  const autoExpandReasoning = input.autoExpandReasoning ?? false;
  return {
    includeThought: (input.includeThought ?? true) && !autoExpandReasoning,
    includeShortText: input.includeShortText ?? false,
    autoExpandReasoning,
  };
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
    calls: steps.filter((step): step is GroupableItem => step.kind !== "assistant_message"),
    toolCalls: steps.filter((step): step is ToolCallItem => step.kind === "tool_call"),
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
  const anchor = run.toolCalls.at(-1) ?? run.latest;
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
  // A single groupable item is itself, not a group. Grouping starts with the second.
  if (run.steps.length > 1) {
    input.groups.set(host.id, input.buildGroup(run));
  }
}

export function prepareGroupedHistory<TGroup>(input: {
  tail: StreamItem[];
  buildGroup: (run: StepRun) => TGroup;
  includeThought?: boolean;
  includeShortText?: boolean;
  autoExpandReasoning?: boolean;
}): GroupedHistory<TGroup> {
  const output: StreamItem[] = [];
  const groups = new Map<string, TGroup>();
  const options = resolveOptions(input);
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
    const groupable = !isFinalAnswer && isGroupableStep(item, options);
    if (groupable && isTurnBoundary(pending.at(-1) ?? null, item)) {
      appendRun({
        steps: pending,
        isSealed: true,
        output,
        groups,
        buildGroup: input.buildGroup,
      });
      pending = [];
    }
    if (groupable) {
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

  const pendingSteps = formsGroup(pending) ? pending : [];
  return {
    tail: groups.size > 0 ? output : input.tail,
    groupsByHostId: groups,
    // Narration alone is emitted as plain rows, so it must not stay pending and get
    // folded into a live run later.
    pendingSteps,
    pendingCalls: pendingSteps.filter(
      (step): step is GroupableItem => step.kind !== "assistant_message",
    ),
  };
}

export function groupLiveToolCalls<TGroup>(input: {
  history: GroupedHistory<TGroup>;
  head: StreamItem[];
  isTurnActive: boolean;
  buildGroup: (run: StepRun) => TGroup;
  includeThought?: boolean;
  autoExpandReasoning?: boolean;
}): GroupedToolCalls<TGroup> {
  const head: StreamItem[] = [];
  // Text still streaming must stay visible: folding it would make the agent's reply
  // disappear until the group is opened.
  const headOptions = resolveOptions({
    includeThought: input.includeThought ?? true,
    includeShortText: false,
    autoExpandReasoning: input.autoExpandReasoning,
  });
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
    const needsLiveGroup = placement === "head" || includesHead || !isSealed;
    if (run.steps.length > 1 && needsLiveGroup) {
      liveGroups.set(run.id, input.buildGroup(run));
    }
  };

  for (const item of input.head) {
    const groupable = isGroupableStep(item, headOptions);
    if (groupable && isTurnBoundary(pending.at(-1) ?? null, item)) {
      flush(true);
    }
    if (groupable) {
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
  const groupsByHostId = new Map(input.history.groupsByHostId);
  let historyGroupUpdatesByHostId: Map<string, TGroup> | null = null;
  for (const [id, group] of liveGroups) {
    groupsByHostId.set(id, group);
    const isHistoryHost =
      input.history.groupsByHostId.has(id) || input.history.pendingCalls[0]?.id === id;
    if (isHistoryHost) {
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
