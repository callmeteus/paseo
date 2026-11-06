import type { PaseoApi } from "@getpaseo/client";
import { defineRpc } from "@getpaseo/plugin";
import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { syncProviderRouters } from "./server/sync.js";

const syncInput = z.object({});
const syncOutput = z.object({
  providers: z.array(z.string()),
  routers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      summary: z.string().optional(),
      mode: z.string(),
      targets: z.array(z.object({ provider: z.string(), model: z.string().nullable() })),
    }),
  ),
});

const syncRpc = defineRpc({ name: "sync", input: syncInput, output: syncOutput });
const runRpc = defineRpc({ name: "run", input: syncInput, output: syncOutput });
const generateRpc = defineRpc({ name: "generate", input: syncInput, output: syncOutput });
const listRpc = defineRpc({ name: "list", input: syncInput, output: syncOutput });
const statusRpc = defineRpc({ name: "status", input: syncInput, output: syncOutput });

const SYNC_DEBOUNCE_MS = 500;

export default function contribute(server: PluginServerContext) {
  let paseo: PaseoApi | null = null;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopped = false;

  const sync = async (): Promise<void> => {
    if (stopped || !paseo || running) return;
    running = true;
    try {
      await syncProviderRouters(paseo);
    } catch (error) {
      // A sync still in flight when the plugin stops fails on the disposed
      // client; that teardown race is expected and not worth a log line.
      if (!stopped) console.error("[provider-routers] sync failed", error);
    } finally {
      running = false;
    }
  };

  const scheduleSync = (): void => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void sync();
    }, SYNC_DEBOUNCE_MS);
    timer.unref?.();
  };

  /** Idempotent: the first call starts the run, later calls only retry the watch. */
  const start = (api: PaseoApi): void => {
    paseo = api;
    if (!unsubscribe) {
      try {
        unsubscribe = api.providers.subscribe(() => scheduleSync());
      } catch (error) {
        console.error("[provider-routers] could not watch the provider catalogue", error);
      }
    }
    scheduleSync();
  };

  const handler = async (
    _input: z.infer<typeof syncInput>,
    { paseo: api }: PluginHandlerContext,
  ) => {
    start(api);
    return (await syncProviderRouters(api)) as z.infer<typeof syncOutput>;
  };

  server.handle(syncRpc, handler);
  server.handle(runRpc, handler);
  server.handle(generateRpc, handler);
  server.handle(listRpc, handler);
  server.handle(statusRpc, handler);

  // The server entry can start work here; it does not have to wait for a hook.
  start(server.paseo);

  return () => {
    stopped = true;
    unsubscribe?.();
    unsubscribe = null;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    paseo = null;
  };
}
