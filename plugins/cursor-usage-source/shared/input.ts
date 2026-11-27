import { z } from "zod";
const cursorStoreSchema = z.object({
  store: z.enum(["env", "file", "sqlite"]),
  locator: z.string().min(1),
});
export const inputSchema = cursorStoreSchema
  .extend({
    // Ordered logins of the same account; tried when the primary one is missing or rejected.
    fallback: z.array(cursorStoreSchema).optional(),
  })
  .strict();
export type UsageInput = z.infer<typeof inputSchema>;
