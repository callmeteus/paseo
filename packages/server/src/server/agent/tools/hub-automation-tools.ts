import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import {
  HubAutomationRequestError,
  listHubAutomations,
  saveHubAutomation,
  type HubAutomationAccess,
} from "../../hub/automation-client.js";
import { PaseoToolInputError, type PaseoToolConfig, type PaseoToolResult } from "./types.js";

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
        "List Hub automations for the connected Hub, including each trigger's YAML. Use this before editing one.",
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
      description: `Create or replace one Hub automation. The name in the YAML is the identity: saving an existing name edits that automation. ${TRIGGER_SHAPE}`,
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
