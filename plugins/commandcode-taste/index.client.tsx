import type { PluginClientContext } from "@getpaseo/plugin/client";
import { TastePanel } from "./client/taste-panel.js";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "taste",
    title: "Taste",
    icon: "Sparkles",
    locations: ["workspace", "explorer"],
    Component: TastePanel,
  });
  client.addCommandCenterItem({
    id: "open-taste",
    title: "Command Code taste",
    icon: "Sparkles",
    keywords: ["taste", "command code", "preferences", "style"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("taste");
    },
  });
  return () => {};
}
