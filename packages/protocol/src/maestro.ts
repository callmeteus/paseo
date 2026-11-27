/**
 * Maestro mode is a chat mode, not a provider mode. The labels live on the chat
 * record so they survive a daemon restart and a provider session reload, the same
 * way the OpenUI chat label does.
 */
export const MAESTRO_CHAT_LABEL = "paseo.maestro";
export const MAESTRO_SCOPE_LABEL = "paseo.maestro.scope";

export type MaestroChatMode = "chat" | "agent" | "maestro";
export type MaestroScope = "workspace" | "all";

/** Upstream skill source. The daemon downloads it into PASEO_HOME and checks for updates. */
export const MAESTRO_SKILL_REPOSITORY = "gtihq/ai-skills";
export const MAESTRO_SKILL_DIRECTORY = "skills/maestro";

/** Relative to PASEO_HOME. One ledger per chat keeps concurrent runs separate. */
export const MAESTRO_LEDGER_DIRECTORY = "maestro/chats";
export const MAESTRO_SKILL_DIRECTORY_NAME = "maestro/skill";

/**
 * Shown at the top of a Maestro chat and added to the system prompt. It is a
 * recommendation, never a forced model choice.
 */
export const MAESTRO_CONTEXT_RECOMMENDATION =
  "Maestro: prefira um modelo com contexto maior para manter mais informação durante a orquestração. Se o usuário escolher outro modelo, siga a escolha dele.";

export function isMaestroChat(labels: Record<string, unknown> | null | undefined): boolean {
  return labels?.[MAESTRO_CHAT_LABEL] === "1";
}

export function getMaestroScope(labels: Record<string, unknown> | null | undefined): MaestroScope {
  return labels?.[MAESTRO_SCOPE_LABEL] === "all" ? "all" : "workspace";
}

export function maestroChatLabels(scope: MaestroScope): Record<string, string> {
  return {
    [MAESTRO_CHAT_LABEL]: "1",
    [MAESTRO_SCOPE_LABEL]: scope,
  };
}

export function maestroLedgerRelativePath(agentId: string): string {
  return `${MAESTRO_LEDGER_DIRECTORY}/${agentId}`;
}
