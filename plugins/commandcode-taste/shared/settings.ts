import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Host-scoped controls for the Command Code taste bridge.
 *
 * Defaults favor the common case: apply taste to every new chat and include the
 * user's global packages. The size cap keeps a large taste profile from
 * ballooning every provider prompt.
 */
export const tastePreferences = defineSettings({
  id: "commandcode-taste",
  scope: "host",
  version: 1,
  schema: z.object({
    applyToOtherProviders: z.boolean().default(true),
    includeGlobal: z.boolean().default(true),
    maxChars: z.number().int().min(4000).max(200000).default(32000),
  }),
});

export const DEFAULT_TASTE_PREFERENCES = {
  applyToOtherProviders: true,
  includeGlobal: true,
  maxChars: 32000,
} as const;
