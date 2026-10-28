import { randomUUID } from "node:crypto";

import type { Logger } from "pino";

import type { AgentTimelineItem, AgentProvider } from "./agent-sdk-types.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { clampSystemPrompt } from "./system-prompt.js";
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
  logger?: Logger;
}

export interface SwapProviderResult {
  newAgentId: string;
  previousAgentId: string;
}

export const MAX_PORTED_TRANSCRIPT_CHARS = 24_000;

const PORTED_CONTEXT_MARKER = "The following conversation was ported from";

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

/**
 * Convert a provider timeline into a plain transcript that another provider can
 * read as context. Tool calls are reduced to a single line so the ported
 * conversation stays readable and bounded.
 */
export function buildPortingTranscript(items: readonly AgentTimelineItem[]): string {
  const lines: string[] = [];

  for (const item of items) {
    if (item.type === "user_message") {
      const text = item.text.trim();
      if (text) lines.push(`User: ${text}`);
    } else if (item.type === "assistant_message") {
      const text = item.text.trim();
      if (text) lines.push(`Assistant: ${text}`);
    } else if (item.type === "tool_call") {
      lines.push(`Assistant used tool ${item.name} (${item.status})`);
    }
  }

  const transcript = lines.join("\n\n").trim();
  if (transcript.length <= MAX_PORTED_TRANSCRIPT_CHARS) {
    return transcript;
  }
  return transcript.slice(transcript.length - MAX_PORTED_TRANSCRIPT_CHARS);
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
  const portedContext = transcript
    ? `${PORTED_CONTEXT_MARKER} ${provider}. Continue it as if you had been the assistant.\n\n${transcript}`
    : "";
  const prompt = [stripPreviousPortedContext(existingPrompt), portedContext]
    .filter(Boolean)
    .join("\n\n");
  return prompt.length > 0 ? clampSystemPrompt(prompt) : undefined;
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

  if (existing.provider === targetProvider && existing.config?.model === targetModel) {
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
