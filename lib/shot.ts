/**
 * Shot model: zod schemas for the shot list. Presets and shotToPrompt live in
 * ./shotPresets (zod-free, imported by the UI) and are re-exported here.
 */
import { z } from "zod";
import { ASPECTS, MAX_TOTAL_SECONDS, SHOT_COUNT, SHOT_SECONDS } from "./renderConfig";
import { CAMERA_MOVES, LENSES, SHOT_TYPES, totalSeconds } from "./shotPresets";

export * from "./shotPresets";

export const ShotSecondsSchema = z.number().int().min(SHOT_SECONDS.min).max(SHOT_SECONDS.max);

/** What the model writes per shot (ids are assigned server-side). */
export const ShotDraftSchema = z.object({
  shotType: z.enum(SHOT_TYPES),
  lens: z.enum(LENSES),
  cameraMove: z.enum(CAMERA_MOVES),
  mood: z.string().min(1).max(80).describe("2-5 words, e.g. 'lonely, hopeful'"),
  action: z.string().min(1).max(300).describe("Exactly one sentence: who/what is on screen and what happens."),
  seconds: ShotSecondsSchema.describe(`Whole seconds, ${SHOT_SECONDS.min}-${SHOT_SECONDS.max}`),
});

export const ShotSchema = ShotDraftSchema.extend({ id: z.string().min(1) });
export type Shot = z.infer<typeof ShotSchema>;

export const ShotListDraftSchema = z.object({
  title: z.string().min(1).max(80),
  tagline: z.string().min(1).max(160),
  shots: z.array(ShotDraftSchema).min(SHOT_COUNT.min).max(SHOT_COUNT.max),
});

export const ShotListSchema = z
  .object({
    title: z.string().min(1).max(80),
    tagline: z.string().min(1).max(160),
    shots: z.array(ShotSchema).min(SHOT_COUNT.min).max(SHOT_COUNT.max),
  })
  .refine((l) => totalSeconds(l.shots) <= MAX_TOTAL_SECONDS, {
    message: `Total duration must be <= ${MAX_TOTAL_SECONDS}s`,
    path: ["shots"],
  });
export type ShotList = z.infer<typeof ShotListSchema>;

export const ShotListRequestSchema = z.object({
  logline: z.string().trim().min(3).max(400),
  aspect: z.enum(ASPECTS).default("16:9"),
});
