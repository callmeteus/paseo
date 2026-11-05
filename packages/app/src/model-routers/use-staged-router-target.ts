import { useDaemonConfig } from "@/hooks/use-daemon-config";
import {
  resolveStagedRouterTarget,
  type PendingProviderSwitch,
} from "@/composer/agent-controls/pending-provider-switch";

/**
 * The provider+model a staged router pick will land on, resolved from the
 * daemon config. Kept out of `AgentControls` so the resolution lives beside the
 * router rules instead of inflating that component.
 */
export function useStagedRouterTarget(
  serverId: string | null,
  pending: PendingProviderSwitch | null,
): { provider: string; model: string | null } | null {
  const { config } = useDaemonConfig(serverId);
  return resolveStagedRouterTarget(pending, config?.modelRouters?.routers);
}
