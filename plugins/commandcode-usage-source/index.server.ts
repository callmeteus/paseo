import type { PluginServerContext } from "@getpaseo/plugin/server";
import { inputSchema } from "./shared/input.js";
import { discover, discoverSession, fetchUsage } from "./server/usage.js";

export default function contribute(server: PluginServerContext) {
  server.registerUsageSource({
    id: "commandcode",
    label: "Command Code",
    icon: "icon.svg",
    input: inputSchema,
    discover: (scope) => (scope.kind === "global" ? discover() : discoverSession(scope)),
    fetch: fetchUsage,
  });
  return () => {};
}
