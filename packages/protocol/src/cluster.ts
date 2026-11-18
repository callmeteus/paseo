import { z } from "zod";

/**
 * Cluster behavior, owned by each daemon. `announceHosts` publishes this daemon's saved host
 * list to daemons it is connected to so they can route through it. `syncHostNames` lets a
 * client's saved label flow back to the daemon; the daemon hostname only fills a missing label.
 */
export const ClusterConfigSchema = z
  .object({
    announceHosts: z.boolean().default(false),
    syncHostNames: z.boolean().default(false),
  })
  .passthrough();

export const ClusterConfigPatchSchema = ClusterConfigSchema.partial();

export type ClusterConfig = z.infer<typeof ClusterConfigSchema>;
