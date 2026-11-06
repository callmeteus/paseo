import equal from "fast-deep-equal";
import type { AgentUsage } from "@getpaseo/protocol/agent-types";
import { preserveChosenWorkflowMode } from "./workflow-mode-selection";

interface AgentUpdateValue {
  updatedAt: Date | string;
  lastUsage?: AgentUsage;
  workflowModeId?: string | null;
  workflowModeRevision?: number;
}

function timestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

export function acceptAgentDirectoryUpdate<T extends AgentUpdateValue>(
  current: T | undefined,
  incoming: T,
): T {
  if (!current || timestamp(incoming.updatedAt) >= timestamp(current.updatedAt)) {
    return preserveChosenWorkflowMode(current, incoming);
  }
  if (incoming.lastUsage === undefined) return current;
  if (equal(incoming.lastUsage, current.lastUsage)) return current;
  return { ...current, lastUsage: incoming.lastUsage };
}
