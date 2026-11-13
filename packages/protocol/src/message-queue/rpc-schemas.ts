import { z } from "zod";

export const AgentQueuedMessageImageSchema = z.object({
  /** Attachment metadata id the image belongs to. */
  id: z.string().min(1),
  mimeType: z.string().min(1),
  fileName: z.string().nullable().optional(),
  /** Base64 bytes without a data URL prefix. */
  data: z.string(),
});
export type AgentQueuedMessageImage = z.infer<typeof AgentQueuedMessageImageSchema>;

export const AgentQueuedMessageSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  /**
   * Composer-owned attachment payload. The daemon persists it without
   * interpreting it so the app can restore attachments exactly.
   */
  attachments: z.array(z.unknown()),
  images: z.array(AgentQueuedMessageImageSchema),
});
export type AgentQueuedMessage = z.infer<typeof AgentQueuedMessageSchema>;

export const AgentMessageQueueListRequestSchema = z.object({
  type: z.literal("agent.message_queue.list.request"),
  requestId: z.string(),
});

export const AgentMessageQueueListResponseSchema = z.object({
  type: z.literal("agent.message_queue.list.response"),
  payload: z.object({
    requestId: z.string(),
    queues: z.record(z.string(), z.array(AgentQueuedMessageSchema)),
    error: z.string().nullable(),
  }),
});

export const AgentMessageQueueSetRequestSchema = z.object({
  type: z.literal("agent.message_queue.set.request"),
  requestId: z.string(),
  agentId: z.string().min(1),
  items: z.array(AgentQueuedMessageSchema),
});

export const AgentMessageQueueSetResponseSchema = z.object({
  type: z.literal("agent.message_queue.set.response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string().min(1),
    items: z.array(AgentQueuedMessageSchema),
    error: z.string().nullable(),
  }),
});

export type AgentMessageQueueListRequest = z.infer<typeof AgentMessageQueueListRequestSchema>;
export type AgentMessageQueueListResponse = z.infer<typeof AgentMessageQueueListResponseSchema>;
export type AgentMessageQueueSetRequest = z.infer<typeof AgentMessageQueueSetRequestSchema>;
export type AgentMessageQueueSetResponse = z.infer<typeof AgentMessageQueueSetResponseSchema>;
