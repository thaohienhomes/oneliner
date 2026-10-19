import { NextResponse } from "next/server";
import { z } from "zod";
import { CONTENT_MESSAGE, contentViolation } from "../../../../../lib/contentFilter";
import { CAMERA_MOVES, LENSES, SHOT_TYPES } from "../../../../../lib/shot";
import { regenerateShotAction, ShotListError } from "../../../../../lib/shotList";

export const maxDuration = 60;

const BodySchema = z.object({
  logline: z.string().trim().min(3).max(400),
  index: z.number().int().min(0).max(5),
  variant: z.number().int().min(0).optional(),
  shot: z.object({
    shotType: z.enum(SHOT_TYPES),
    lens: z.enum(LENSES),
    cameraMove: z.enum(CAMERA_MOVES),
    mood: z.string().max(80),
    action: z.string().max(300),
  }),
});

/** Rewrite one shot's action sentence. */
export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_request", message: z.prettifyError(parsed.error) }, { status: 400 });

  if (contentViolation(parsed.data.logline)) return NextResponse.json({ error: "content_blocked", message: CONTENT_MESSAGE }, { status: 422 });

  try {
    return NextResponse.json(await regenerateShotAction(parsed.data));
  } catch (err) {
    const status = err instanceof ShotListError ? err.httpStatus : 500;
    console.error("[shotlist/regenerate]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "regenerate_failed", message: "Couldn't rewrite that shot. Try again." }, { status });
  }
}
