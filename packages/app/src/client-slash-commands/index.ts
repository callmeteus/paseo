import type { Agent } from "@/stores/session-store";
import type { WorkspaceDraftTabSetup } from "@/workspace-tabs/model";

export type ClientSlashCommandKind =
  | "archive-agent"
  | "replace-agent-with-draft"
  | "toggle-chat-mode";
export type ClientSlashCommandExecution = "immediate" | "insert";

export interface ClientSlashCommand {
  name: string;
  aliases: readonly string[];
  description: string;
  descriptionKey:
    | "composer.clientCommands.archiveAgent"
    | "composer.clientCommands.freshDraft"
    | "composer.clientCommands.chatMode";
  argumentHint: string;
  kind: ClientSlashCommandKind;
  execution: ClientSlashCommandExecution;
  /** Commands with an argument accept trailing text, e.g. `/mode chat`. */
  acceptsArgument?: boolean;
  /** Parsed trailing argument when `acceptsArgument` is set. */
  argument?: string | null;
}

export const CLIENT_SLASH_COMMANDS: readonly ClientSlashCommand[] = [
  {
    name: "exit",
    aliases: ["quit", "q"],
    description: "Archive the current agent",
    descriptionKey: "composer.clientCommands.archiveAgent",
    argumentHint: "",
    kind: "archive-agent",
    execution: "immediate",
  },
  {
    name: "clear",
    aliases: ["new"],
    description: "Archive this agent and start a fresh draft",
    descriptionKey: "composer.clientCommands.freshDraft",
    argumentHint: "",
    kind: "replace-agent-with-draft",
    execution: "immediate",
  },
  {
    name: "mode",
    aliases: [],
    description: "Switch this chat between Chat (OpenUI) and Agent mode",
    descriptionKey: "composer.clientCommands.chatMode",
    argumentHint: "[chat|agent]",
    kind: "toggle-chat-mode",
    execution: "immediate",
    acceptsArgument: true,
  },
];

const COMMAND_BY_NAME = new Map<string, ClientSlashCommand>();
for (const command of CLIENT_SLASH_COMMANDS) {
  COMMAND_BY_NAME.set(command.name, command);
  for (const alias of command.aliases) {
    COMMAND_BY_NAME.set(alias, command);
  }
}

export function resolveClientSlashCommand(input: {
  text: string;
  hasAttachments: boolean;
}): ClientSlashCommand | null {
  if (input.hasAttachments) {
    return null;
  }

  // A client slash command can be invoked anywhere in the message, not only at
  // the very start, so scan for a `/name` token regardless of leading text.
  const tokenMatch = /(?:^|\s)\/([^\s]+)/.exec(input.text);
  if (!tokenMatch) {
    return null;
  }

  const commandName = tokenMatch[1];
  if (!commandName) {
    return null;
  }

  const command = COMMAND_BY_NAME.get(commandName);
  if (!command) {
    return null;
  }

  // Client commands take no arguments unless they opt in: reject when trailing
  // text follows the command token.
  const tokenEnd = tokenMatch.index + tokenMatch[0].length;
  const trailing = input.text.slice(tokenEnd).trim();
  if (command.acceptsArgument) {
    return { ...command, argument: trailing.length > 0 ? trailing : null };
  }
  if (trailing.length > 0) {
    return null;
  }

  return command;
}

export function buildDraftAgentSetup(agent: Agent): WorkspaceDraftTabSetup {
  const featureValues: Record<string, unknown> = {};
  for (const feature of agent.features ?? []) {
    featureValues[feature.id] = feature.value;
  }

  return {
    provider: agent.provider,
    cwd: agent.cwd,
    modeId: agent.currentModeId ?? agent.runtimeInfo?.modeId ?? null,
    model: agent.model ?? agent.runtimeInfo?.model ?? null,
    thinkingOptionId: agent.thinkingOptionId ?? agent.runtimeInfo?.thinkingOptionId ?? null,
    featureValues,
  };
}
