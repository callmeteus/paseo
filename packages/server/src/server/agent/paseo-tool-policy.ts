import type { ProviderPaseoToolsPolicy } from "@getpaseo/protocol/provider-config";

interface ProviderPaseoToolSettings {
  paseoTools?: ProviderPaseoToolsPolicy;
}

export function resolvePaseoToolPolicy(
  providerId: string,
  providerSettings: Readonly<Record<string, ProviderPaseoToolSettings>> | undefined,
): ProviderPaseoToolsPolicy | undefined {
  return providerSettings?.[providerId]?.paseoTools;
}

export function isPaseoToolEnabled(
  policy: ProviderPaseoToolsPolicy | undefined,
  toolName: string,
): boolean {
  if (toolName === "speak") {
    return true;
  }
  // Hub automations, the Slack reads they need, and the plan tools stay
  // callable when the rest of the catalog is off. Plan mode tells the model to
  // write the sidebar plan with plan_create_update and to start executing it
  // with plan_build. A provider can still hide one with disabledTools.
  if (
    toolName === "list_automations" ||
    toolName === "save_automation" ||
    toolName === "list_slack_channels" ||
    toolName === "read_slack_messages" ||
    toolName === "plan_create_update" ||
    toolName === "plan_build"
  ) {
    return !policy?.disabledTools?.includes(toolName);
  }
  if (!isPaseoToolPolicyEnabled(policy)) {
    return false;
  }
  return !policy?.disabledTools?.includes(toolName);
}

export function isPaseoToolPolicyEnabled(policy: ProviderPaseoToolsPolicy | undefined): boolean {
  return policy?.enabled !== false;
}
