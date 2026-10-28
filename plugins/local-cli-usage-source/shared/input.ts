import { z } from "zod";

export const OpencodeInputSchema = z.object({ source: z.literal("opencode") }).strict();
export const KiloInputSchema = z.object({ source: z.literal("kilo") }).strict();
export const ClineInputSchema = z.object({ source: z.literal("cline") }).strict();

export type LocalCliSource = "opencode" | "kilo" | "cline";
export interface Input {
  source: LocalCliSource;
}
