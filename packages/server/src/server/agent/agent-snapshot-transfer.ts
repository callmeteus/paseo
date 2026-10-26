import type {
  AgentSnapshot,
  AgentSnapshotBlock,
  AgentSnapshotTurn,
} from "@getpaseo/protocol/agent-snapshot";

import type { AgentSessionConfig, AgentTimelineItem } from "./agent-sdk-types.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import type { AgentManager } from "./agent-manager.js";
import type { ManagedAgent } from "./agent-manager.js";
import { MAX_PORTED_TRANSCRIPT_CHARS } from "./agent-provider-swap.js";
import type { AgentStorage } from "./agent-storage.js";

type SnapshotAgentManager = Pick<AgentManager, "createAgent" | "getTimeline">;

export interface ExportAgentSnapshotInput {
  storage: Pick<AgentStorage, "get">;
  agentManager: Pick<AgentManager, "getAgent" | "getTimeline">;
  agentId: string;
}

export interface ImportAgentSnapshotInput {
  storage: Pick<AgentStorage, "get" | "upsert">;
  agentManager: SnapshotAgentManager;
  snapshot: AgentSnapshot;
  targetProvider: string;
  targetModel: string | null;
  workspaceId: string;
  sourceHost?: string;
}

export interface ImportedAgentSnapshot {
  agentId: string;
}

export class AgentSnapshotTransferError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentSnapshotTransferError";
  }
}

function readTextBlocks(blocks: readonly AgentSnapshotBlock[]): string {
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function buildSnapshotTurn(item: AgentTimelineItem): AgentSnapshotTurn | null {
  switch (item.type) {
    case "user_message": {
      const text = item.text.trim();
      return text ? { role: "user", blocks: [{ type: "text", text }] } : null;
    }
    case "assistant_message": {
      const text = item.text.trim();
      return text ? { role: "assistant", blocks: [{ type: "text", text }] } : null;
    }
    case "reasoning": {
      const text = item.text.trim();
      return text ? { role: "assistant", blocks: [{ type: "text", text }] } : null;
    }
    case "tool_call":
      return {
        role: "assistant",
        blocks: [
          {
            type: "tool_call",
            id: item.callId,
            name: item.name,
            args: item.detail,
          },
          ...(item.status === "failed"
            ? [
                {
                  type: "tool_result" as const,
                  toolCallId: item.callId,
                  result: item.error,
                  isError: true,
                },
              ]
            : []),
        ],
      };
    case "notification":
      return { role: "system", blocks: [{ type: "text", text: item.message }] };
    case "error":
      return { role: "system", blocks: [{ type: "text", text: item.message }] };
    default:
      return null;
  }
}

export function buildSnapshotTurns(items: readonly AgentTimelineItem[]): AgentSnapshotTurn[] {
  const turns: AgentSnapshotTurn[] = [];
  for (const item of items) {
    const turn = buildSnapshotTurn(item);
    if (turn) turns.push(turn);
  }
  return turns;
}

export async function exportAgentSnapshot(input: ExportAgentSnapshotInput): Promise<AgentSnapshot> {
  const record = await input.storage.get(input.agentId);
  if (!record) {
    throw new AgentSnapshotTransferError("agent.notFound", `Agent ${input.agentId} not found`);
  }
  const items = input.agentManager.getAgent(input.agentId)
    ? input.agentManager.getTimeline(input.agentId)
    : [];
  return {
    version: "paseo.agent-snapshot/v1",
    agentId: record.id,
    title: record.title ?? null,
    provider: record.provider,
    model: record.config?.model ?? null,
    cwd: record.cwd,
    ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
    createdAt: record.createdAt,
    turns: buildSnapshotTurns(items),
    ...(record.migratedFrom ? { migratedFrom: record.migratedFrom } : {}),
  };
}

/**
 * Reduce a snapshot to the plain transcript the target provider receives as
 * context. Kept separate from the timeline projection so the imported agent's
 * system prompt reads like a conversation, not a serialized timeline.
 */
export function buildSnapshotTranscript(snapshot: AgentSnapshot): string {
  const lines: string[] = [];
  for (const turn of snapshot.turns) {
    const text = readTextBlocks(turn.blocks);
    if (!text) continue;
    if (turn.role === "user") lines.push(`User: ${text}`);
    else if (turn.role === "assistant") lines.push(`Assistant: ${text}`);
    else lines.push(`System: ${text}`);
  }
  const transcript = lines.join("\n\n").trim();
  if (transcript.length <= MAX_PORTED_TRANSCRIPT_CHARS) {
    return transcript;
  }
  return transcript.slice(transcript.length - MAX_PORTED_TRANSCRIPT_CHARS);
}

function buildImportedSystemPrompt(snapshot: AgentSnapshot): string | undefined {
  const transcript = buildSnapshotTranscript(snapshot);
  if (!transcript) return undefined;
  return `The following conversation was ported from ${snapshot.provider}. Continue it as if you had been the assistant.\n\n${transcript}`;
}

function toolCallItem(
  block: Extract<AgentSnapshotBlock, { type: "tool_call" }>,
): AgentTimelineItem {
  return {
    type: "tool_call",
    callId: block.id,
    name: block.name,
    status: "completed",
    error: null,
    detail: {
      type: "unknown",
      input: block.args ?? null,
      output: null,
    },
  };
}

function turnItems(turn: AgentSnapshotTurn): AgentTimelineItem[] {
  const text = readTextBlocks(turn.blocks);
  const items: AgentTimelineItem[] = [];
  if (text) {
    if (turn.role === "user") items.push({ type: "user_message", text });
    else if (turn.role === "assistant") items.push({ type: "assistant_message", text });
    else items.push({ type: "notification", level: "info", message: text });
  }
  for (const block of turn.blocks) {
    if (block.type === "tool_call") items.push(toolCallItem(block));
  }
  return items;
}

export function buildImportedTimelineRows(snapshot: AgentSnapshot): AgentTimelineRow[] {
  const rows: AgentTimelineRow[] = [];
  const fallbackTimestamp = new Date().toISOString();
  for (const turn of snapshot.turns) {
    const timestamp = turn.timestamp ?? fallbackTimestamp;
    for (const item of turnItems(turn)) {
      rows.push({ seq: rows.length + 1, timestamp, item });
    }
  }
  return rows;
}

export async function importAgentSnapshot(
  input: ImportAgentSnapshotInput,
): Promise<ImportedAgentSnapshot> {
  const { snapshot, targetProvider, targetModel } = input;
  if (!targetProvider.trim()) {
    throw new AgentSnapshotTransferError("agent.invalidProvider", "Target provider is required");
  }
  if (snapshot.version !== "paseo.agent-snapshot/v1") {
    throw new AgentSnapshotTransferError(
      "agent.invalidSnapshot",
      `Unsupported agent snapshot version: ${snapshot.version}`,
    );
  }

  const timelineRows = buildImportedTimelineRows(snapshot);
  const systemPrompt = buildImportedSystemPrompt(snapshot);
  const config: AgentSessionConfig = {
    provider: targetProvider,
    cwd: snapshot.cwd,
    ...(targetModel ? { model: targetModel } : {}),
    ...(snapshot.title ? { title: snapshot.title } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
  };

  let created: ManagedAgent;
  try {
    created = await input.agentManager.createAgent(config, undefined, {
      labels: {},
      timelineRows,
      timelineNextSeq: timelineRows.length + 1,
      initialTitle: snapshot.title ?? null,
      workspaceId: input.workspaceId,
    });
  } catch (error) {
    throw new AgentSnapshotTransferError(
      "agent.importFailed",
      error instanceof Error ? error.message : String(error),
    );
  }

  const record = await input.storage.get(created.id);
  if (record) {
    await input.storage.upsert({
      ...record,
      migratedFrom: {
        provider: snapshot.provider,
        agentId: snapshot.agentId,
        ...(input.sourceHost ? { host: input.sourceHost } : {}),
        portedAt: new Date().toISOString(),
      },
    });
  }

  return { agentId: created.id };
}
