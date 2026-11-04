import type { PluginServerContext } from "@getpaseo/plugin/server";
import { signedOutClaudeReport, withInstalledClaudeAccount } from "./server/installed-account.js";
import { discover, fetchUsage } from "./server/usage.js";
import { inputSchema } from "./shared/input.js";

export default function contribute(server: PluginServerContext) {
  server.registerUsageSource({
    id: "claude",
    label: "Claude",
    icon: "icon.svg",
    input: inputSchema,
    discover: async (scope) => withInstalledClaudeAccount(scope, await discover(scope)),
    fetch: async (input) => {
      const parsed = inputSchema.parse(input);
      const signedOut = signedOutClaudeReport(parsed);

      if (signedOut) {
        return signedOut;
      }

      return fetchUsage(parsed);
    },
  });
  return () => {};
}
