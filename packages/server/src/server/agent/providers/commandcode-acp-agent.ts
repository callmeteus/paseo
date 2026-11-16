import { stripBackgroundProviderNotice } from "@getpaseo/protocol/provider-error";
import type { Logger } from "pino";

import { GenericACPAgentClient } from "./generic-acp-agent.js";

// Command Code forwards background harness warnings to ACP clients as assistant text.
// Taste learning calls POST /alpha/generate on its own. A credits failure there is not
// the model's answer: it arrives as a trailing chunk, or as the prompt RPC rejecting
// after the turn already streamed its reply.
export function suppressCommandCodeBackgroundNotice(text: string, logger?: Logger): string | null {
  const stripped = stripBackgroundProviderNotice(text);
  if (stripped === text) return text;
  logger?.debug({ notice: text.trim() }, "Suppressed Command Code background notice");
  return stripped;
}

interface CommandCodeACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
}

/**
 * Command Code ACP shim. It keeps the generic adapter and only drops harness notices
 * that are not part of the conversation.
 */
export class CommandCodeACPAgentClient extends GenericACPAgentClient {
  constructor(options: CommandCodeACPAgentClientOptions) {
    super({
      logger: options.logger,
      command: options.command,
      env: options.env,
      providerId: options.providerId ?? "commandcode",
      label: options.label ?? "Command Code",
      assistantTextTransform: (text) => suppressCommandCodeBackgroundNotice(text, options.logger),
    });
  }
}
