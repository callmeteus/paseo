import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const tasteFileSchema = z.object({
  /** Path relative to the project root, or to the home directory for global packages. */
  relativePath: z.string(),
  /** Absolute path so the app can open the file. */
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  modifiedAt: z.string(),
});

const tasteLearningSchema = z.object({
  enabled: z.boolean(),
  /** File that decided the setting, or null when nothing set it. */
  source: z.string().nullable(),
});

export const listTasteRpc = defineRpc({
  name: "taste.list",
  input: z.object({ cwd: z.string().min(1) }),
  output: z.object({
    projectRoot: z.string().nullable(),
    learning: tasteLearningSchema,
    project: z.array(tasteFileSchema),
    global: z.array(tasteFileSchema),
    applyToOtherProviders: z.boolean(),
    includeGlobal: z.boolean(),
    maxChars: z.number().int(),
  }),
});

export const previewTasteRpc = defineRpc({
  name: "taste.preview",
  input: z.object({ cwd: z.string().min(1) }),
  output: z.object({
    block: z.string(),
    files: z.array(z.string()),
    truncated: z.boolean(),
  }),
});

export type TasteFile = z.infer<typeof tasteFileSchema>;
export type ListTasteResult = z.infer<typeof listTasteRpc.output>;
export type PreviewTasteResult = z.infer<typeof previewTasteRpc.output>;
