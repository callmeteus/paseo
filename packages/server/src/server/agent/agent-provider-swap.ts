import { randomUUID } from "node:crypto";

import type { Logger } from "pino";

import type { AgentTimelineItem, AgentProvider } from "./agent-sdk-types.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import {
  clampSystemPrompt,
  PORTED_CONTEXT_MARKER,
  preserveSuffixSystemPrompt,
} from "./system-prompt.js";
import type { AgentStorage, StoredAgentRecord } from "./agent-storage.js";

export interface SwapProviderInput {
  storage: AgentStorage;
  agentId: string;
  targetProvider: string;
  targetModel: string | null;
  previousItems?: readonly AgentTimelineItem[];
  /** Rows to persist on the new record so a ported chat survives reloads. */
  portedTimeline?: readonly AgentTimelineRow[];
  /** Defaults to true. False leaves the source agent for the client to archive. */
  archivePrevious?: boolean;
  /**
   * Router binding for the ported chat. Omitted (or null) detaches it, matching
   * a switch to a plain model; the binding is never inherited from the source.
   */
  modelRouterId?: string | null;
  /** True allows a same provider+model port (repairs a corrupt session). */
  force?: boolean;
  logger?: Logger;
}

export interface SwapProviderResult {
  newAgentId: string;
  previousAgentId: string;
}

export const MAX_PORTED_TRANSCRIPT_CHARS = 24_000;

/** Long single messages are cut so one paragraph cannot starve the rest of the transcript. */
const MAX_PORTED_ENTRY_CHARS = 4_000;
const OMITTED_CONTEXT_MARKER = "[... earlier turns omitted when porting ...]";

/**
 * Timeline rows for the ported agent: the previous conversation followed by a
 * porting marker. The marker is a real timeline item (like compaction) so it is
 * recorded, persisted, and rendered from the timeline instead of being inferred
 * from migration metadata.
 */
export function buildPortedTimelineRows(input: {
  previousRows: readonly AgentTimelineRow[];
  fromProvider?: AgentProvider | null;
  toProvider: AgentProvider;
  portedAt: string;
}): AgentTimelineRow[] {
  const rows: AgentTimelineRow[] = input.previousRows.map((row, index) => ({
    seq: index + 1,
    timestamp: row.timestamp,
    item: row.item,
  }));
  rows.push({
    seq: rows.length + 1,
    timestamp: input.portedAt,
    item: {
      type: "porting",
      status: "completed",
      ...(input.fromProvider ? { fromProvider: input.fromProvider } : {}),
      toProvider: input.toProvider,
    },
  });
  return rows;
}

interface PortingToolCall {
  name: string;
  status: string;
}

function formatToolRun(calls: readonly PortingToolCall[]): string {
  const [only] = calls;
  if (calls.length === 1 && only) {
    return `Assistant used tool ${only.name} (${only.status})`;
  }
  const counts = new Map<string, number>();
  for (const call of calls) {
    counts.set(call.name, (counts.get(call.name) ?? 0) + 1);
  }
  const summary = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([name, count]) => `${name}×${count}`)
    .join(", ");
  return `Assistant used ${calls.length} tools (${summary})`;
}

/**
 * One entry per message, with each run of tool calls collapsed into a single line. Writing
 * one line per tool call let a tool-heavy stretch fill the whole budget, which is how a
 * ported chat lost its conversation and read only "Assistant used tool execute (completed)"
 * — the task itself never survived.
 */
function buildTranscriptEntries(items: readonly AgentTimelineItem[]): string[] {
  const entries: string[] = [];
  let toolRun: PortingToolCall[] = [];
  const flushTools = () => {
    if (toolRun.length === 0) {
      return;
    }
    entries.push(formatToolRun(toolRun));
    toolRun = [];
  };

  for (const item of items) {
    if (item.type === "tool_call") {
      toolRun.push({ name: item.name, status: item.status });
      continue;
    }
    flushTools();
    if (item.type === "user_message") {
      const text = item.text.trim();
      if (text) entries.push(`User: ${text}`);
    } else if (item.type === "assistant_message") {
      const text = item.text.trim();
      if (text) entries.push(`Assistant: ${text}`);
    }
  }
  flushTools();
  return entries;
}

function clampEntry(entry: string): string {
  return entry.length <= MAX_PORTED_ENTRY_CHARS
    ? entry
    : `${entry.slice(0, MAX_PORTED_ENTRY_CHARS)}…`;
}

/**
 * Convert a provider timeline into a plain transcript that another provider can read as
 * context.
 *
 * When it does not fit, the opening request is kept and the rest is filled from the most
 * recent turns. Trimming happens on whole entries: slicing by character offset used to cut
 * the first line mid-word (`xecute (completed)`) and drop the message that named the task.
 */
export function buildPortingTranscript(items: readonly AgentTimelineItem[]): string {
  const entries = buildTranscriptEntries(items).map(clampEntry);
  if (entries.length === 0) {
    return "";
  }

  const full = entries.join("\n\n").trim();
  if (full.length <= MAX_PORTED_TRANSCRIPT_CHARS) {
    return full;
  }

  // The first user message names what the ported chat is supposed to keep doing.
  const anchorIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.startsWith("User: ")),
  );
  const anchor = entries[anchorIndex] ?? "";
  const rest = entries.filter((_entry, index) => index !== anchorIndex);

  const kept: string[] = [];
  let used = anchor.length;
  for (let index = rest.length - 1; index >= 0; index -= 1) {
    const entry = rest[index] ?? "";
    const cost = entry.length + 2;
    if (used + cost > MAX_PORTED_TRANSCRIPT_CHARS) {
      break;
    }
    kept.unshift(entry);
    used += cost;
  }

  return [anchor, OMITTED_CONTEXT_MARKER, ...kept].filter(Boolean).join("\n\n").trim();
}

/**
 * A port chains through providers: every hop used to append another transcript
 * to the previous ported one, so prompts grew until OpenCode rejected them with
 * HTTP 413. Drop the previous ported section before writing the new one.
 */
function stripPreviousPortedContext(prompt: string | null | undefined): string {
  const trimmed = prompt?.trim() ?? "";
  if (!trimmed) return "";
  const index = trimmed.lastIndexOf(PORTED_CONTEXT_MARKER);
  return index >= 0 ? trimmed.slice(0, index).trim() : trimmed;
}

function buildPortedSystemPrompt(
  existingPrompt: string | null | undefined,
  provider: string,
  items: readonly AgentTimelineItem[] | undefined,
): string | undefined {
  const transcript = items && items.length > 0 ? buildPortingTranscript(items) : "";
  const base = stripPreviousPortedContext(existingPrompt);
  if (!transcript) {
    const prompt = base;
    return prompt.length > 0 ? clampSystemPrompt(prompt) : undefined;
  }
  const portedContext = `${PORTED_CONTEXT_MARKER} ${provider}. Continue it as if you had been the assistant.\n\n${transcript}`;
  return preserveSuffixSystemPrompt(base, portedContext);
}

function latestTimestamp(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

function lastUserMessageTimestamp(rows: readonly AgentTimelineRow[]): string | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.item.type === "user_message") return row.timestamp;
  }
  return null;
}

export class SwapProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "SwapProviderError";
  }
}

export async function swapAgentProvider(input: SwapProviderInput): Promise<SwapProviderResult> {
  const { storage, agentId, targetProvider, targetModel } = input;

  const existing = await storage.get(agentId);
  if (!existing) {
    throw new SwapProviderError("agent.notFound", `Agent ${agentId} not found`, 404);
  }

  if (!targetProvider || targetProvider.trim().length === 0) {
    throw new SwapProviderError("agent.invalidProvider", "Target provider is required", 400);
  }

  if (
    !input.force &&
    existing.provider === targetProvider &&
    existing.config?.model === targetModel
  ) {
    throw new SwapProviderError(
      "agent.sameProvider",
      "Agent already uses the requested provider and model",
      400,
    );
  }

  const newAgentId = randomUUID();
  const now = new Date().toISOString();
  const systemPrompt = buildPortedSystemPrompt(
    existing.config?.systemPrompt,
    existing.provider,
    input.previousItems,
  );
  // Mode, thinking, features and provider options name things inside the source
  // provider. Carrying them over makes the target reject the agent (for example
  // OpenCode treating Cline's "act" mode as an unknown agent). Let the target
  // provider pick its own defaults; only the transcript and Paseo-level settings
  // cross the boundary.
  const {
    modeId: _sourceModeId,
    thinkingOptionId: _sourceThinkingOptionId,
    featureValues: _sourceFeatureValues,
    providerOptions: _sourceProviderOptions,
    model: _sourceModel,
    ...portedConfig
  } = existing.config ?? {};

  const portedRows = input.portedTimeline ?? [];
  const lastUserMessageAt = latestTimestamp(
    existing.lastUserMessageAt ?? null,
    lastUserMessageTimestamp(portedRows),
  );

  const newRecord: StoredAgentRecord = {
    ...existing,
    id: newAgentId,
    provider: targetProvider,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    lastStatus: "closed",
    lastModeId: null,
    archivedAt: null,
    // A port never inherits the source's router binding: the caller decides
    // whether the ported chat runs on a router or on a plain model.
    modelRouterId: input.modelRouterId ?? null,
    // A port starts a new branch: it must not inherit the source's outgoing
    // link (that stale pointer hides the ported tab from the tab bar).
    migratedTo: undefined,
    lastUserMessageAt,
    lastError: null,
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    config: {
      ...portedConfig,
      model: targetModel,
      ...(systemPrompt ? { systemPrompt } : {}),
    },
    runtimeInfo: { provider: targetProvider, sessionId: null, model: targetModel },
    persistence: null,
    migratedFrom: {
      provider: existing.provider,
      agentId: existing.id,
      portedAt: now,
    },
    ...(portedRows.length
      ? {
          portedTimeline: portedRows.map((row) => ({
            seq: row.seq,
            timestamp: row.timestamp,
            item: row.item,
          })) as StoredAgentRecord["portedTimeline"],
        }
      : {}),
  };

  await storage.upsert(newRecord);

  // Archive the previous agent, preserving the migratedTo link. When the caller
  // keeps it open during the port, stop at the link and let the client archive
  // after it has switched chats.
  await storage.upsert({
    ...existing,
    ...(input.archivePrevious === false ? {} : { archivedAt: now }),
    migratedTo: { provider: targetProvider, agentId: newAgentId, portedAt: now },
  });

  return { newAgentId, previousAgentId: agentId };
}
