import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ChatHistoryContextAttachment } from "@/attachments/types";

type AgentForkContextPayload = Awaited<ReturnType<DaemonClient["buildAgentForkContext"]>>;

/** The inline mention chip uses this id, so the tray can tell it from a fork pill. */
export function chatMentionAttachmentId(agentId: string): string {
  return `chat_history:mention:${agentId}`;
}

interface BuildChatHistoryAttachmentInput {
  /** Stable per source chat: the attachments store replaces on a repeated id. */
  id: string;
  serverId: string;
  agentId: string;
  payload: AgentForkContextPayload;
  missingAttachmentMessage: string;
}

/**
 * One chat-history attachment shape for both entry points: forking (a draft seeded
 * with a boundary) and mentioning a past chat from the `@` picker (the whole chat).
 */
export function buildChatHistoryAttachment(
  input: BuildChatHistoryAttachmentInput,
): ChatHistoryContextAttachment {
  if (!input.payload.attachment) {
    throw new Error(input.missingAttachmentMessage);
  }
  return {
    kind: "chat_history",
    id: input.id,
    attachment: input.payload.attachment,
    source: {
      serverId: input.serverId,
      agentId: input.agentId,
      boundaryMessageId: input.payload.boundaryMessageId,
      boundaryCursor: input.payload.boundaryCursor,
      itemCount: input.payload.itemCount,
    },
  };
}

interface CreateChatMentionAttachmentInput {
  client: DaemonClient;
  serverId: string;
  agentId: string;
  missingAttachmentMessage: string;
}

export async function createChatMentionAttachment(
  input: CreateChatMentionAttachmentInput,
): Promise<ChatHistoryContextAttachment> {
  const payload = await input.client.buildAgentForkContext(input.agentId);
  return buildChatHistoryAttachment({
    id: chatMentionAttachmentId(input.agentId),
    serverId: input.serverId,
    agentId: input.agentId,
    payload,
    missingAttachmentMessage: input.missingAttachmentMessage,
  });
}
