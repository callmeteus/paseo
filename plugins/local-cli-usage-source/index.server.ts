import type { PluginServerContext } from "@getpaseo/plugin/server";
import { ClineInputSchema, KiloInputSchema, OpencodeInputSchema } from "./shared/input.js";
import { discover, fetchUsage } from "./server/usage.js";

export default function contribute(server: PluginServerContext) {
  server.registerUsageSource({
    id: "opencode-local",
    label: "OpenCode (local)",
    icon: "icon.svg",
    input: OpencodeInputSchema,
    discover: async (scope) => (scope.kind === "global" ? discover("opencode") : []),
    fetch: (input) => fetchUsage(input as { source: "opencode" }),
  });
  server.registerUsageSource({
    id: "kilo-local",
    label: "Kilo (local)",
    icon: "icon.svg",
    input: KiloInputSchema,
    discover: async (scope) => (scope.kind === "global" ? discover("kilo") : []),
    fetch: (input) => fetchUsage(input as { source: "kilo" }),
  });
  server.registerUsageSource({
    id: "cline-local",
    label: "Cline (local)",
    icon: "icon.svg",
    input: ClineInputSchema,
    discover: async (scope) => (scope.kind === "global" ? discover("cline") : []),
    fetch: (input) => fetchUsage(input as { source: "cline" }),
  });
  return () => {};
}
