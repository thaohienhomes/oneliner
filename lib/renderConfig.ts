/**
 * Shared render + shot constraints. Single source of truth for the shot-list
 * schema, the editor UI, and the Comfy render route.
 *
 * LTX-2.3 I2V (workflows/ltx23_i2v_api.json) only accepts whole-second
 * durations (frames = Duration * FPS + 1), and renders at W/2 x H/2 before a
 * x2 upscale, so sizes must be multiples of 64. 768x448 / 448x768 satisfy that.
 */

export const ASPECTS = ["16:9", "9:16"] as const;
export type Aspect = (typeof ASPECTS)[number];
export const DEFAULT_ASPECT: Aspect = "16:9";

export const RENDER_SIZE: Record<Aspect, { width: number; height: number }> = {
  "16:9": { width: 768, height: 448 },
  "9:16": { width: 448, height: 768 },
};

/** Whole seconds only. */
export const SHOT_SECONDS = { min: 2, max: 4, default: 3 } as const;
export const SHOT_COUNT = { min: 4, max: 6 } as const;
export const MAX_TOTAL_SECONDS = 13;

/** Matches the "Frame Rate" default (320:300) in the LTX-2.3 workflow. */
export const FPS = 25;

/** Frames LTX is asked for (the workflow derives length = Duration * FPS + 1). */
export const ltxFrames = (seconds: number) => Math.round(seconds) * FPS + 1;

/** Max Comfy render jobs in flight at once from one editor. */
export const MAX_CONCURRENT_RENDERS = 3;
