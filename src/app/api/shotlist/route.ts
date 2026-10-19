import { NextResponse } from "next/server";
import { z } from "zod";
import { CONTENT_MESSAGE, contentViolation } from "../../../../lib/contentFilter";
import { RENDER_SIZE } from "../../../../lib/renderConfig";
import { ShotListRequestSchema } from "../../../../lib/shot";
import { generateShotList, ShotListError } from "../../../../lib/shotList";

export const maxDuration = 60;

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = ShotListRequestSchema.safeParse(json);
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_request", message: z.prettifyError(parsed.error) }, { status: 400 });

  const { logline, aspect } = parsed.data;
  if (contentViolation(logline)) return NextResponse.json({ error: "content_blocked", message: CONTENT_MESSAGE }, { status: 422 });
  try {
    const list = await generateShotList(logline, aspect);
    return NextResponse.json({ ...list, aspect, size: RENDER_SIZE[aspect] });
  } catch (err) {
    const status = err instanceof ShotListError ? err.httpStatus : 500;
    console.error("[shotlist]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "shotlist_failed", message: "Couldn't write the shot list. Try again in a moment." }, { status });
  }
}
