import type { PluginClientContext } from "@getpaseo/plugin/client";

import { getOverlayBridge } from "./client/bridge-access";
import { OverlayRoot } from "./client/overlay-root";
import { OverlaySettings } from "./client/settings";

/**
 * Registra a screen do overlay, as configurações e o atalho do Command Center.
 *
 * @param client Contexto do plugin no app.
 * @returns Função de limpeza.
 */
export default function contribute(client: PluginClientContext) {
  client.addScreen({
    id: "overlay",
    title: "Floating chats",
    Component: OverlayRoot,
  });
  client.addSettingsScreen({
    id: "settings",
    title: "Floating chats",
    icon: "PanelsTopLeft",
    Component: OverlaySettings,
  });
  client.addCommandCenterItem({
    id: "toggle-floating-chats",
    title: "Toggle floating chats",
    icon: "PanelsTopLeft",
    context: "global",
    onSelect() {
      void getOverlayBridge()?.toggle?.();
    },
  });
  return () => {};
}
