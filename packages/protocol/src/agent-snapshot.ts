import { z } from "zod";

export const AgentSnapshotVersionSchema = z.literal("paseo.agent-snapshot/v1");

export const AgentSnapshotMessageRoleSchema = z.enum(["user", "assistant", "tool", "system"]);

export const AgentSnapshotTextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const AgentSnapshotToolCallBlockSchema = z.object({
  type: z.literal("tool_call"),
  id: z.string(),
  name: z.string(),
  args: z.unknown().optional(),
});

export const AgentSnapshotToolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  toolCallId: z.string(),
  result: z.unknown().optional(),
  isError: z.boolean().optional(),
});

export const AgentSnapshotBlockSchema = z.discriminatedUnion("type", [
  AgentSnapshotTextBlockSchema,
  AgentSnapshotToolCallBlockSchema,
  AgentSnapshotToolResultBlockSchema,
]);

export const AgentSnapshotTurnSchema = z.object({
  role: AgentSnapshotMessageRoleSchema,
  blocks: z.array(AgentSnapshotBlockSchema),
  timestamp: z.string().optional(),
});

export const AgentSnapshotSchema = z.object({
  version: AgentSnapshotVersionSchema,
  agentId: z.string(),
  title: z.string().nullable().optional(),
  provider: z.string(),
  model: z.string().nullable().optional(),
  cwd: z.string(),
  workspaceId: z.string().optional(),
  createdAt: z.string(),
  turns: z.array(AgentSnapshotTurnSchema),
  migratedFrom: z
    .object({
      provider: z.string(),
      agentId: z.string(),
      host: z.string().optional(),
    })
    .optional(),
  providerCheckpoint: z.record(z.string(), z.unknown()).optional(),
});

export type AgentSnapshot = z.infer<typeof AgentSnapshotSchema>;
export type AgentSnapshotTurn = z.infer<typeof AgentSnapshotTurnSchema>;
export type AgentSnapshotBlock = z.infer<typeof AgentSnapshotBlockSchema>;
