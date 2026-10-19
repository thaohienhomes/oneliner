/**
 * Server-side validation for POST /api/shot. Rejects (never clamps) anything
 * outside the budget: max SHOT_COUNT.max shots per trailer, whole seconds in
 * SHOT_SECONDS, size within I2V_MAX_SIZE, prompt length.
 */
import { z } from "zod";
import { ASPECTS, SHOT_COUNT, SHOT_SECONDS } from "./renderConfig";
import { I2V_MAX_SIZE } from "./workflowMap";

export const MAX_PROMPT_CHARS = 1200;
export const MAX_NEGATIVE_CHARS = 600;

export const ShotRequestSchema = z
  .object({
    prompt: z.string().trim().min(1, "prompt is required").max(MAX_PROMPT_CHARS, `prompt is longer than ${MAX_PROMPT_CHARS} characters`),
    negative: z.string().max(MAX_NEGATIVE_CHARS).optional(),
    seed: z.number().int().min(0).max(2 ** 48).optional(),
    aspect: z.enum(ASPECTS).default("16:9"),
    width: z.number().int().min(64).max(I2V_MAX_SIZE.width).optional(),
    height: z.number().int().min(64).max(I2V_MAX_SIZE.height).optional(),
    seconds: z
      .number()
      .int(`seconds must be a whole number (${SHOT_SECONDS.min}-${SHOT_SECONDS.max})`)
      .min(SHOT_SECONDS.min)
      .max(SHOT_SECONDS.max, `max ${SHOT_SECONDS.max}s per shot`)
      .default(SHOT_SECONDS.default),
    /** 0-based position in the trailer, when the editor sends it. */
    shotIndex: z.number().int().min(0).max(SHOT_COUNT.max - 1, `max ${SHOT_COUNT.max} shots per trailer`).optional(),
  })
  .refine((r) => (r.width ?? 0) * (r.height ?? 0) <= I2V_MAX_SIZE.pixels, {
    message: `max resolution is ${I2V_MAX_SIZE.pixels} pixels (e.g. 768x448)`,
    path: ["width"],
  });

export type ShotRequest = z.infer<typeof ShotRequestSchema>;
