import type { SessionInboundMessage } from "@getpaseo/protocol/messages";
import type { RemoteAccessCapability } from "@getpaseo/protocol/remote-access";

/**
 * Which remote capability an inbound RPC belongs to. Types that are not listed
 * keep their ordinary authority, so observation and unrelated features keep
 * working across a routed link.
 */
export const REMOTE_OPERATION_FAMILIES = {
  // Chats
  "chat.search.request": "chats",

  // Agent lifecycle and delegation. Listing/fetching agents stays unrestricted.
  create_agent_request: "agents",
  "agent.create.request": "agents",
  send_agent_message_request: "agents",
  "agent.message_queue.set.request": "agents",
  abort_request: "agents",
  cancel_agent_request: "agents",
  resume_agent_request: "agents",
  refresh_agent_request: "agents",
  delete_agent_request: "agents",
  archive_agent_request: "agents",
  close_items_request: "agents",
  set_agent_mode_request: "agents",
  set_agent_model_request: "agents",
  set_agent_thinking_request: "agents",
  set_agent_feature_request: "agents",
  "agent.config.apply.request": "agents",
  "agent.workspace.set.request": "agents",
  "agent.chat_mode.set.request": "agents",
  "agent.workflow_mode.set.request": "agents",
  "agent.rewind.request": "agents",
  "agent.fork_context.request": "agents",
  "workspace.create.request": "agents",
  archive_workspace_request: "agents",
  "workspace.delete.request": "agents",
  "workspace.setup.run.request": "agents",

  // Files
  file_explorer_request: "files.read",
  "fs.file.subscribe.request": "files.read",
  "fs.search.request": "files.read",
  "fs.file.write.request": "files.write",
  "fs.entry.create.request": "files.write",
  "fs.entry.rename.request": "files.write",
  "fs.entry.duplicate.request": "files.write",
  "fs.entry.delete.request": "files.write",

  // Command execution
  "process.exec.request": "commands",
  create_terminal_request: "commands",
  terminal_input: "commands",
  capture_terminal_request: "commands",
  kill_terminal_request: "commands",
} as const satisfies Partial<Record<SessionInboundMessage["type"], RemoteAccessCapability>>;

export type RemoteOperationFamily = RemoteAccessCapability;

export function remoteOperationFamily(
  type: SessionInboundMessage["type"],
): RemoteOperationFamily | null {
  return (
    (REMOTE_OPERATION_FAMILIES as Record<string, RemoteOperationFamily | undefined>)[type] ?? null
  );
}

/** Families that carry a `cwd` and must respect the workspace restriction. */
export function operationCarriesCwd(
  message: SessionInboundMessage,
): message is SessionInboundMessage & { cwd: string } {
  return "cwd" in message && typeof message.cwd === "string";
}
