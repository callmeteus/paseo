import { z } from "zod";

export const McpCatalogSourceSchema = z.enum([
  "claude",
  "cursor",
  "codex",
  "opencode",
  "pi",
  "paseo",
]);

export const McpCatalogTransportSchema = z.enum(["stdio", "http", "sse"]);

export const DetectedMcpServerSchema = z.object({
  source: McpCatalogSourceSchema,
  name: z.string().min(1),
  transport: McpCatalogTransportSchema,
  config: z.record(z.string(), z.unknown()),
  sourcePath: z.string(),
  warnings: z.array(z.string()),
  alreadyConfigured: z.boolean(),
});

export const McpCatalogScanRequestSchema = z.object({
  type: z.literal("mcp.catalog.scan.request"),
  requestId: z.string(),
});

export const McpCatalogScanResponseSchema = z.object({
  type: z.literal("mcp.catalog.scan.response"),
  payload: z.object({
    requestId: z.string(),
    servers: z.array(DetectedMcpServerSchema),
    errors: z.array(z.string()),
  }),
});

export const McpCatalogImportTargetSchema = z.object({
  source: McpCatalogSourceSchema,
  name: z.string().min(1),
  sourcePath: z.string(),
  replace: z.boolean().optional(),
});

export const McpCatalogImportRequestSchema = z.object({
  type: z.literal("mcp.catalog.import.request"),
  requestId: z.string(),
  entries: z.array(McpCatalogImportTargetSchema).min(1),
});

export const McpCatalogImportResponseSchema = z.object({
  type: z.literal("mcp.catalog.import.response"),
  payload: z.object({
    requestId: z.string(),
    imported: z.array(z.string()),
    skipped: z.array(z.string()),
    errors: z.array(z.string()),
  }),
});

export const McpCatalogTestRequestSchema = z.object({
  type: z.literal("mcp.catalog.test.request"),
  requestId: z.string(),
  config: z.record(z.string(), z.unknown()),
});

export const McpCatalogTestResponseSchema = z.object({
  type: z.literal("mcp.catalog.test.response"),
  payload: z.object({
    requestId: z.string(),
    ok: z.boolean(),
    tools: z.array(z.string()),
    error: z.string().nullable(),
  }),
});

export type McpCatalogSource = z.infer<typeof McpCatalogSourceSchema>;
export type DetectedMcpServer = z.infer<typeof DetectedMcpServerSchema>;
export type McpCatalogScanRequest = z.infer<typeof McpCatalogScanRequestSchema>;
export type McpCatalogScanResponse = z.infer<typeof McpCatalogScanResponseSchema>;
export type McpCatalogImportTarget = z.infer<typeof McpCatalogImportTargetSchema>;
export type McpCatalogImportRequest = z.infer<typeof McpCatalogImportRequestSchema>;
export type McpCatalogImportResponse = z.infer<typeof McpCatalogImportResponseSchema>;
export type McpCatalogTestRequest = z.infer<typeof McpCatalogTestRequestSchema>;
export type McpCatalogTestResponse = z.infer<typeof McpCatalogTestResponseSchema>;
