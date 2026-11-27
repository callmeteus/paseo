import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const ioGuardSettings = defineSettings({
  id: "io-guard",
  scope: "host",
  version: 1,
  schema: z.object({
    enabled: z.boolean().default(true),
    fileThresholdMB: z.number().int().min(10).max(1000000).default(500),
    growthThresholdMB: z.number().int().min(1).max(100000).default(50),
    diskFreeThresholdGB: z.number().int().min(1).max(10000).default(20),
    checkIntervalSeconds: z.number().int().min(10).max(3600).default(60),
    drives: z.array(z.string().min(1)).default(["C:\\", "G:\\"]),
  }),
});

export type IoGuardSettings = z.output<typeof ioGuardSettings.schema>;

export function defaultSettings(): IoGuardSettings {
  return ioGuardSettings.schema.parse({});
}
