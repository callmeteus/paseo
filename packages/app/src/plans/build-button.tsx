import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Hammer } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { usePaneContext } from "@/panels/pane-context";
import { usePlan } from "@/plans/store";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";
import { navigateToAgent } from "@/utils/navigate-to-agent";

/**
 * Build button shown on a plan file preview. Switches the plan's agent back to
 * Agent workflow mode and sends the plan file as the task.
 */
export function PlanBuildButton({ path }: { path: string }) {
  const { serverId, workspaceId } = usePaneContext();
  const plan = usePlan({ serverId, workspaceId, path });
  const client = useHostRuntimeClient(serverId);
  const { t } = useTranslation();
  const toast = useToast();
  const [isBuilding, setIsBuilding] = useState(false);

  const handleBuild = useCallback(async () => {
    if (!plan || !client) return;
    setIsBuilding(true);
    try {
      await client.setAgentWorkflowMode(plan.agentId, "agent");
      await client.sendAgentMessage(
        plan.agentId,
        t("panels.file.plan.buildPrompt", { path: plan.path }),
      );
      navigateToAgent({ serverId, agentId: plan.agentId });
    } catch (error) {
      toast.error(toErrorMessage(error));
    } finally {
      setIsBuilding(false);
    }
  }, [client, plan, serverId, t, toast]);

  if (!plan) return null;

  return (
    <Button
      variant="default"
      size="sm"
      leftIcon={Hammer}
      loading={isBuilding}
      onPress={handleBuild}
      testID="plan-build-button"
    >
      {t("panels.file.plan.build")}
    </Button>
  );
}
