import type { PluginServerContext, PluginHandlerContext } from "@getpaseo/plugin/server";
import { defineRpc } from "@getpaseo/plugin";
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
      targets: z.array(z.object({ provider: z.string(), model: z.string() })),
    }),
  ),
});

const syncRpc = defineRpc({ name: "sync", input: syncInput, output: syncOutput });
const runRpc = defineRpc({ name: "run", input: syncInput, output: syncOutput });
const generateRpc = defineRpc({ name: "generate", input: syncInput, output: syncOutput });
const listRpc = defineRpc({ name: "list", input: syncInput, output: syncOutput });
const statusRpc = defineRpc({ name: "status", input: syncInput, output: syncOutput });

export default function contribute(server: PluginServerContext) {
  const handler = async (_input: z.infer<typeof syncInput>, { paseo }: PluginHandlerContext) => {
    const result = await syncProviderRouters(paseo);
    return result as z.infer<typeof syncOutput>;
  };
  server.handle(syncRpc, handler);
  server.handle(runRpc, handler);
  server.handle(generateRpc, handler);
  server.handle(listRpc, handler);
  server.handle(statusRpc, handler);
  return () => {};
}
