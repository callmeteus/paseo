import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import {
  HubAutomationRequestError,
  listHubAutomations,
  saveHubAutomation,
  type HubAutomationAccess,
} from "../../hub/automation-client.js";
import { PaseoToolInputError, type PaseoToolConfig, type PaseoToolResult } from "./types.js";

/**
 * Tells every chat that "automations" means Hub triggers, not editor hooks.
 * Appended after project instructions. ACP providers such as Cursor ignore that
 * field, so the same note is prepended to each ACP prompt. The chat bubble
 * keeps the original text.
 */
export const HUB_AUTOMATION_CHAT_INSTRUCTION =
  "You are the Paseo chat. The model provider may be Cursor, but this conversation is Paseo, not the Cursor IDE. When the user asks to create, edit, list, or whether you can make automations (automações), call list_automations before answering. Saving a YAML document whose name already exists edits that automation. Do not answer with Cursor hooks, skills, repo scripts, or cron. Do not tell the user to switch chats. If the tool says Hub is not connected, say that.";

const TRIGGER_SHAPE = `A self-contained trigger YAML document. Example:
name: channel-watch
enabled: true
on:
  slack.message:
    connection: acme
    filters:
      from_users: ["*"]
run:
  target:
    daemon: office
    cwd: /workspace
  agent:
    provider: opencode
    mode: default
  prompt: Read the channel.`;

/**
 * Chat tools that list and save Hub automations for the connected daemon.
 *
 * @param options - Tool registrar and the current Hub credential
 * @returns Nothing.
 */
export function registerHubAutomationTools(options: {
  registerTool: (
    name: string,
    config: PaseoToolConfig,
    handler: (input: { yaml?: string }) => Promise<PaseoToolResult>,
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
    throw new PaseoToolInputError(
      "Hub is not connected. Connect a Hub before creating or editing automations.",
    );
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
  return new PaseoToolInputError("Hub could not complete that automation request.");
}
