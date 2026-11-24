import type { PluginAgentSnapshot } from "@getpaseo/plugin";

/** Estado de atenção que coloca o chat no topo da tira. */
export function needsInput(agent: PluginAgentSnapshot): boolean {
  return (
    agent.requiresAttention ||
    agent.attentionReason === "permission" ||
    agent.attentionReason === "question"
  );
}

/**
 * Comparador de agentes: aguardando resposta primeiro, depois atividade mais recente.
 *
 * @param left Primeiro agente.
 * @param right Segundo agente.
 * @returns Número negativo quando left vem primeiro.
 */
export function compareRecentAgents(left: PluginAgentSnapshot, right: PluginAgentSnapshot): number {
  const activity = right.lastActivityAt.localeCompare(left.lastActivityAt);
  if (activity !== 0) return activity;
  const updated = right.updatedAt.localeCompare(left.updatedAt);
  if (updated !== 0) return updated;
  return left.id.localeCompare(right.id);
}

/**
 * Filtra agentes encerrados antes de ordenar a tira.
 *
 * @param agent Snapshot do agente.
 * @returns Verdadeiro quando o agente pode aparecer no overlay.
 */
export function isVisibleAgent(agent: PluginAgentSnapshot): boolean {
  return agent.status !== "closed" && !agent.background;
}

/**
 * Deriva a cor de status do anel a partir do bucket de atenção.
 *
 * @param agent Snapshot do agente.
 * @returns Chave da cor no tema do plugin.
 */
export function statusColorKey(
  agent: PluginAgentSnapshot,
): "statusDotWarning" | "statusDotDanger" | "statusDotRunning" | "statusDotSuccess" | null {
  if (needsInput(agent)) return "statusDotWarning";
  if (agent.status === "error" || agent.attentionReason === "error") return "statusDotDanger";
  if (agent.status === "running") return "statusDotRunning";
  if (agent.requiresAttention || agent.attentionReason === "finished") return "statusDotSuccess";
  return null;
}

/**
 * Iniciais mostradas no centro da bolinha.
 *
 * @param title Título do chat.
 * @returns Uma ou duas letras maiúsculas.
 */
export function initialsFor(title: string | null): string {
  const clean = (title ?? "").trim();
  if (!clean) return "?";
  const words = clean.split(/\s+/).slice(0, 2);
  return words.map((word) => word[0]?.toUpperCase() ?? "").join("");
}
