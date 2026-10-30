import type { Logger } from "pino";

import { GenericACPAgentClient } from "./generic-acp-agent.js";

// Command Code forwards background harness warnings to ACP clients as assistant text.
// Taste learning is a background feature, so its failure is not the model's answer: it
// lands as a second, raw error line right after the turn's own provider error.
const COMMANDCODE_TASTE_NOTICE = /^taste learning failed:/i;

export function suppressCommandCodeBackgroundNotice(text: string, logger?: Logger): string | null {
  const trimmed = text.trim();
  if (!COMMANDCODE_TASTE_NOTICE.test(trimmed)) return text;
  logger?.debug({ notice: trimmed }, "Suppressed Command Code background notice");
  return null;
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
