import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { saveGeneratedFile } from "@/stores/download-store";
import { exportAgentChat } from "@/timeline/export-chat-jsonl";
import {
  claimAgentChatExportRequest,
  useAgentChatExportRequest,
} from "./agent-chat-export-request";

/**
 * Runs an export requested from a chat tab menu. The menu only knows the agent id;
 * this host has the session and the toast.
 */
export function AgentChatExportHost({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const request = useAgentChatExportRequest();
  const handledNonce = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!request || request.nonce === handledNonce.current) return;
    const claimed = claimAgentChatExportRequest(request.nonce);
    if (!claimed) return;
    handledNonce.current = claimed.nonce;
    if (inFlight.current) return;
    inFlight.current = true;
    const session = useSessionStore.getState().sessions[serverId];
    const agent =
      session?.agents.get(claimed.agentId) ?? session?.agentDetails.get(claimed.agentId);
    const { agentId } = claimed;
    const title = agent?.title ?? null;
    toast.show(t("workspace.tabs.menu.exportChatPending"));
    void (async () => {
      try {
        const { fileName } = await exportAgentChat({
          title,
          agentId,
          fetchTimeline: () => fetchProjectedChat(serverId, agentId),
          saveFile: saveGeneratedFile,
        });
        toast.show(t("workspace.tabs.menu.exportChatDone", { fileName }), { variant: "success" });
      } catch {
        toast.error(t("workspace.tabs.menu.exportChatFailed"));
      } finally {
        inFlight.current = false;
      }
    })();
  }, [request, serverId, t, toast]);

  return null;
}

function fetchProjectedChat(serverId: string, agentId: string) {
  // The runtime fetch writes the page into the open chat. Export only needs the file.
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client) {
    throw new Error("export chat: no host client");
  }
  return client.fetchAgentTimeline(agentId, {
    direction: "tail",
    limit: 0,
    projection: "projected",
  });
}
