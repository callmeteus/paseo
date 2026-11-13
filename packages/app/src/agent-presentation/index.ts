import { useShallow } from "zustand/shallow";
import { useProviderIcon } from "@/components/provider-icons";
import type { PanelDescriptor } from "@/panels/panel-registry";
import { useSessionStore, selectAgentTurnPresentation, type Agent } from "@/stores/session-store";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { providerDisplayName } from "@/utils/provider-display-name";

export function resolveAgentLabel(title: string | null | undefined): string | null {
  if (typeof title !== "string") {
    return null;
  }
  const normalized = title.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toLowerCase() === "new agent") {
    return null;
  }
  return normalized;
}

export function useAgentDescriptor(
  target: { kind: "agent"; agentId: string },
  context: { serverId: string },
): PanelDescriptor {
  const descriptorState = useSessionStore(
    useShallow((state) => {
      const session = state.sessions[context.serverId];
      const agent =
        session?.agents?.get(target.agentId) ?? session?.agentDetails?.get(target.agentId) ?? null;
      return {
        provider: agent?.provider ?? "codex",
        title: agent?.title ?? null,
        status: agent?.status ?? null,
        pendingPermissionCount: agent?.pendingPermissions.length ?? 0,
        requiresAttention: agent?.requiresAttention ?? false,
        attentionReason: agent?.attentionReason ?? null,
        isTurnActive: selectAgentTurnPresentation(session, target.agentId).isActive,
      };
    }),
  );
  const icon = useProviderIcon(descriptorState.provider, context.serverId);
  return buildAgentDescriptor({ ...descriptorState, icon });
}

export function buildAgentDescriptor(input: {
  provider: Agent["provider"];
  title: string | null;
  status: Agent["status"] | null;
  pendingPermissionCount: number;
  requiresAttention: boolean;
  attentionReason: Agent["attentionReason"];
  isTurnActive: boolean;
  icon: PanelDescriptor["icon"];
}): PanelDescriptor {
  const provider = input.provider;
  const providerName = provider ? providerDisplayName(provider) : "Agent";
  const label = resolveAgentLabel(input.title);

  return {
    label: label ?? "",
    subtitle: `${providerName} agent`,
    tooltip: label ?? `${providerName} agent`,
    titleState: label ? "ready" : "loading",
    icon: input.icon,
    statusBucket: input.status
      ? deriveSidebarStateBucket({
          status: input.isTurnActive ? "running" : input.status,
          pendingPermissionCount: input.pendingPermissionCount,
          requiresAttention: input.requiresAttention,
          attentionReason: input.attentionReason,
        })
      : null,
  };
}
