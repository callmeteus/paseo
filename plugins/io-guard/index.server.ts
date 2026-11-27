import type { PluginServerContext } from "@getpaseo/plugin/server";
import { cleanupFile, createMonitor } from "./server/monitor.js";
import { attachRpc, cleanupRpc, statusRpc } from "./shared/contracts.js";
import { ioGuardSettings } from "./shared/settings.js";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(ioGuardSettings);
  const monitor = createMonitor(settings);

  server.handle(attachRpc, async (_input, context) => {
    monitor.setPaseo(context.paseo);
    return { ok: true };
  });
  server.handle(statusRpc, async () => monitor.getStatus());
  server.handle(cleanupRpc, async ({ path }) => cleanupFile(path));

  const offTurnStart = server.on("agent.turn_started", (event) => {
    monitor.markLiveAgent(event.agent.id);
  });
  const offTurnEnd = server.on("agent.turn_ended", async (event, context) => {
    monitor.markLiveAgent(event.agent.id);
    await monitor.runOnce(context.paseo);
  });

  void monitor.start();

  return () => {
    offTurnStart();
    offTurnEnd();
    monitor.stop();
  };
}
