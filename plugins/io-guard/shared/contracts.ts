import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const ALERT_KIND = "io-guard-alert";
export const ALERT_ID = "io-guard-alert";

export const findingSchema = z.object({
  kind: z.enum(["file-size", "file-growth", "disk-free", "disk-error"]),
  severity: z.enum(["warning", "critical"]),
  title: z.string(),
  detail: z.string(),
  path: z.string().optional(),
  sizeMB: z.number().optional(),
  freeGB: z.number().optional(),
});

export type Finding = z.output<typeof findingSchema>;

export const fileInfoSchema = z.object({
  path: z.string(),
  sizeMB: z.number(),
  modifiedAt: z.string(),
});

export const diskInfoSchema = z.object({
  drive: z.string(),
  freeGB: z.number(),
  totalGB: z.number(),
});

export const statusSchema = z.object({
  findings: z.array(findingSchema),
  files: z.array(fileInfoSchema),
  disks: z.array(diskInfoSchema),
  lastCheck: z.string().nullable(),
  nextCheck: z.string().nullable(),
  config: z.object({
    enabled: z.boolean(),
    fileThresholdMB: z.number(),
    growthThresholdMB: z.number(),
    diskFreeThresholdGB: z.number(),
    checkIntervalSeconds: z.number(),
    drives: z.array(z.string()),
  }),
});

export type IoGuardStatus = z.output<typeof statusSchema>;

export const attachRpc = defineRpc({
  name: "io-guard.attach",
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
});

export const statusRpc = defineRpc({
  name: "io-guard.status",
  input: z.object({}),
  output: statusSchema,
});

export const cleanupRpc = defineRpc({
  name: "io-guard.cleanup",
  input: z.object({ path: z.string().min(1) }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
});

export const alertSchema = z.object({
  cleared: z.boolean().default(false),
  severity: z.enum(["warning", "critical"]).default("warning"),
  title: z.string(),
  details: z.array(z.string()),
  checkedAt: z.string(),
  files: z
    .array(
      z.object({
        path: z.string(),
        sizeMB: z.number(),
      }),
    )
    .default([]),
});

export type AlertData = z.output<typeof alertSchema>;
