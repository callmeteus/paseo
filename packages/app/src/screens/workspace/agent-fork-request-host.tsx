import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useForkAgent } from "@/hooks/use-fork-agent";
import { useSessionStore } from "@/stores/session-store";
import { claimAgentForkRequest, useAgentForkRequest } from "./agent-fork-request";

/**
 * Runs a fork requested from a chat tab menu. The menu only knows the agent id;
 * this host has the session, the workspace, and the toast.
 */
export function AgentForkRequestHost({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const request = useAgentForkRequest();
  const forkAgent = useForkAgent({ serverId, toast });
  const handledNonce = useRef(0);

  useEffect(() => {
    if (!request || request.nonce === handledNonce.current) return;
    const agent = useSessionStore.getState().sessions[serverId]?.agents?.get(request.agentId);
    if (!agent) return;
    const claimed = claimAgentForkRequest(request.nonce);
    if (!claimed) return;
    handledNonce.current = claimed.nonce;
    const { agentId, target } = claimed;
    void forkAgent({
      agentId,
      agent,
      workspaceId: agent.workspaceId ?? workspaceId,
      target,
    });
  }, [forkAgent, request, serverId, t, toast, workspaceId]);

  return null;
}
