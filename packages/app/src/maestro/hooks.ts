import { useSessionStore } from "@/stores/session-store";
import { getMaestroScope, isMaestroChat, type MaestroScope } from "@getpaseo/protocol/maestro";

export function useMaestroChat(serverId: string | undefined, agentId: string | undefined) {
  const labels = useSessionStore((state) =>
    serverId && agentId ? (state.sessions[serverId]?.agents?.get(agentId)?.labels ?? null) : null,
  );
  const isMaestro = isMaestroChat(labels);
  const scope: MaestroScope = getMaestroScope(labels);
  return { isMaestro, scope };
}
