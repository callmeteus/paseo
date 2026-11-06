import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import {
  HubAutomationRequestError,
  listHubAutomations,
  listHubSlackChannels,
  readHubSlackMessages,
  saveHubAutomation,
  type HubAutomationAccess,
} from "../../hub/automation-client.js";
import { PaseoToolInputError, type PaseoToolConfig, type PaseoToolResult } from "./types.js";

/**
 * Tells every chat that "automations" means Hub triggers, not editor hooks.
 * Providers with a system prompt receive this through daemonAppendSystemPrompt.
 * Cursor ACP has no system-prompt field. session/new only takes the working
 * directory and MCP servers, and session/prompt is stored as the user message.
 * The same note is the Paseo MCP server instructions, which Cursor sends with
 * the tool list. Do not copy it into the user message.
 */
export const HUB_AUTOMATION_CHAT_INSTRUCTION =
  "You are the Paseo chat. The model provider may be Cursor, but this conversation is Paseo, not the Cursor IDE. When the user asks to create, edit, list, or whether you can make automations (automações), call list_automations before answering. Saving a YAML document whose name already exists edits that automation. Slack filters.channels stores channel ids, not names. Call list_slack_channels with the channel name before you invent an id or ask the user for one. If that query returns no channel, call it again with a shorter part of the name before saying the channel does not exist. Call read_slack_messages before you say you cannot read Slack. A slack.message trigger replies in the thread when the run includes slack.reply. A Slack run can call react with an emoji name, such as eyes, to react to the triggering message. Hub does not add a reaction on its own. run.agent.provider may be cursor, claude, codex, or opencode. Set run.agent.model and run.agent.thinkingOptionId when the user names a model. For Cursor, run.agent.features.fast is the string false unless they ask for Fast. Do not answer with Cursor hooks, skills, repo scripts, or cron. Do not tell the user to switch chats. If a tool says Hub is not connected, say that.";

const TRIGGER_SHAPE = `A self-contained trigger YAML document. Use the connection slug and channel ids from list_slack_channels. Example:
name: channel-watch
enabled: true
on:
  slack.message:
    connection: acme
    filters:
      from_users: ["*"]
      channels: ["C0123"]
run:
  target:
    daemon: office
    cwd: /workspace
  agent:
    provider: opencode
    mode: default
  prompt: Read the new message and reply in the thread.
  outputs:
    slack.reply:
      max: 3`;

/**
 * Chat tools that list and save Hub automations, and read Slack through the connected Hub.
 *
 * @param options - Tool registrar and the current Hub credential
 * @returns Nothing.
 */
interface HubChatToolInput {
  yaml?: string;
  connection?: string;
  query?: string;
  channel?: string;
  limit?: number;
}

export function registerHubAutomationTools(options: {
  registerTool: (
    name: string,
    config: PaseoToolConfig,
    handler: (input: HubChatToolInput) => Promise<PaseoToolResult>,
  ) => void;
  hubAutomations?: () => HubAutomationAccess | null;
}): void {
  options.registerTool(
    "list_automations",
    {
      title: "List automations",
      description:
        "List automations in this Paseo chat. Call this before answering any request to create, edit, list, or ask whether you can make automations. These are Hub triggers, not Cursor hooks or skills. Do not tell the user this is the Cursor IDE.",
      inputSchema: {},
      outputSchema: {
        automations: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            enabled: z.boolean(),
            format: z.string(),
            yaml: z.string(),
          }),
        ),
      },
    },
    async () => {
      const access = requireAccess(options.hubAutomations);
      try {
        const automations = await listHubAutomations(access);
        return { content: [], structuredContent: ensureValidJson({ automations }) };
      } catch (error) {
        throw automationFailure(error);
      }
    },
  );

  options.registerTool(
    "save_automation",
    {
      title: "Save automation",
      description: `Create or edit one Paseo Hub automation when the user asks for an automation. The YAML name is the identity: saving an existing name replaces that automation. ${TRIGGER_SHAPE}`,
      inputSchema: {
        yaml: z.string().trim().min(1).describe(TRIGGER_SHAPE),
      },
      outputSchema: {
        triggerId: z.string(),
        name: z.string(),
        revisionId: z.string(),
        version: z.number(),
        active: z.literal(true),
      },
    },
    async (input) => {
      const yaml = input.yaml?.trim() ?? "";
      if (yaml.length === 0) {
        throw new PaseoToolInputError("yaml is required");
      }
      const access = requireAccess(options.hubAutomations);
      try {
        const saved = await saveHubAutomation(access, yaml);
        return { content: [], structuredContent: ensureValidJson(saved) };
      } catch (error) {
        throw automationFailure(error);
      }
    },
  );

  options.registerTool(
    "list_slack_channels",
    {
      title: "List Slack channels",
      description:
        "Lists Slack channels the connected Hub bot can see. Pass query with the channel name (a leading # is optional). If the result is empty, call again with a shorter part of the name. Omit connection when the organization has one Slack connection. Use the returned id in filters.channels. Do not invent a channel id or ask the user for one.",
      inputSchema: {
        connection: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .optional()
          .describe("Slack connection slug. Omit when Hub has one Slack connection."),
        query: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .optional()
          .describe("Channel name to match, such as tecnologia-triagem-teste."),
      },
    },
    async (input) => {
      const access = requireAccess(options.hubAutomations);
      try {
        const listed = await listHubSlackChannels(access, {
          connection: blankToUndefined(input.connection),
          query: blankToUndefined(input.query),
        });
        return { content: [], structuredContent: ensureValidJson(listed) };
      } catch (error) {
        throw automationFailure(error);
      }
    },
  );

  options.registerTool(
    "read_slack_messages",
    {
      title: "Read Slack messages",
      description:
        "Reads recent messages from a Slack channel so you can see how requests are written there. channel is a name or an id from list_slack_channels. Newest messages come first. isReply is true when that message is already inside a thread. A slack.message automation replies in the thread of the new message when the YAML includes slack.reply. Do not say this chat cannot read Slack.",
      inputSchema: {
        connection: z.string().trim().min(1).max(100).optional(),
        channel: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .describe("Channel name or id. A leading # is optional."),
        limit: z.number().int().min(1).max(50).optional().describe("How many messages to read."),
      },
    },
    async (input) => {
      const channel = blankToUndefined(input.channel);
      if (channel === undefined) {
        throw new PaseoToolInputError("Pass the Slack channel name or id.");
      }
      const access = requireAccess(options.hubAutomations);
      try {
        const messages = await readHubSlackMessages(access, {
          channel,
          connection: blankToUndefined(input.connection),
          limit: input.limit,
        });
        return { content: [], structuredContent: ensureValidJson(messages) };
      } catch (error) {
        throw automationFailure(error);
      }
    },
  );
}

/**
 * @param hubAutomations - Current connection, when the daemon has one
 * @returns Credential for the Hub request
 */
function requireAccess(
  hubAutomations: (() => HubAutomationAccess | null) | undefined,
): HubAutomationAccess {
  const access = hubAutomations?.() ?? null;
  if (access === null) {
    throw new PaseoToolInputError("Hub is not connected. Connect a Hub before using automations.");
  }
  return access;
}

/**
 * @param error - Failure from the Hub client
 * @returns A tool error the chat can show
 */
function automationFailure(error: unknown): Error {
  if (error instanceof HubAutomationRequestError) {
    return new PaseoToolInputError(error.message);
  }
  if (error instanceof PaseoToolInputError) {
    return error;
  }
  return new PaseoToolInputError("Hub could not complete that request.");
}

/**
 * @param value - Optional tool text
 * @returns The trimmed text, or undefined when it is blank
 */
function blankToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed;
}
