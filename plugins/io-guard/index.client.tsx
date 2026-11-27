import type { PluginClientContext } from "@getpaseo/plugin/client";
import { IoGuardAlertCard } from "./client/alert-card.js";
import { IoGuardSettingsScreen } from "./client/settings-screen.js";
import { alertSchema, ALERT_KIND, attachRpc } from "./shared/contracts.js";

export default function contribute(client: PluginClientContext) {
  const removeRenderer = client.addTimelineRenderer({
    kind: ALERT_KIND,
    version: 1,
    schema: alertSchema,
    Component: IoGuardAlertCard,
  });
  const removeSettings = client.addSettingsScreen({
    id: "main",
    title: "IO Guard",
    icon: "ShieldAlert",
    Component: IoGuardSettingsScreen,
  });

  void client.rpc(attachRpc, {}).catch((error) => {
    console.error("[io-guard] falha ao registrar canal de alertas", error);
  });

  return () => {
    removeRenderer();
    removeSettings();
  };
}
