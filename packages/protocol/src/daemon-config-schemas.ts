import { z } from "zod";

const McpStdioServerConfigSchema = z.object({
  type: z.literal("stdio"),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  // COMPAT(mcpStdioCwd): added in v0.13.2, optional so older daemons ignore it.
  cwd: z.string().optional(),
  alwaysLoad: z.boolean().optional(),
});

const McpHttpServerConfigSchema = z.object({
  type: z.literal("http"),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  alwaysLoad: z.boolean().optional(),
});

const McpSseServerConfigSchema = z.object({
  type: z.literal("sse"),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  alwaysLoad: z.boolean().optional(),
});

export const McpServerConfigSchema = z.discriminatedUnion("type", [
  McpStdioServerConfigSchema,
  McpHttpServerConfigSchema,
  McpSseServerConfigSchema,
]);

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const McpShareSchema = z
  .object({
    hosts: z.array(z.string().min(1)),
    tools: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const McpBridgeSchema = z
  .object({
    host: z.string().min(1),
    via: z.string().min(1).optional(),
    server: z.string().min(1),
  })
  .strict();

export type McpShare = z.infer<typeof McpShareSchema>;
export type McpBridge = z.infer<typeof McpBridgeSchema>;

export const IDLE_RUNTIME_CLEANUP_AFTER = ["15m", "30m", "1h", "2h", "4h", "8h", "24h"] as const;
export const IdleRuntimeCleanupAfterSchema = z.enum(IDLE_RUNTIME_CLEANUP_AFTER);
export type IdleRuntimeCleanupAfter = (typeof IDLE_RUNTIME_CLEANUP_AFTER)[number];
