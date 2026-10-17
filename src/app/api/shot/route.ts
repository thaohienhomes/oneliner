import { NextResponse } from "next/server";
import { DEFAULT_ASPECT, RENDER_SIZE, SHOT_SECONDS, type Aspect } from "../../../../lib/renderConfig";
import { getFirstFrame, renderFirstFrame, renderShot, snapVideoSize, toRenderError } from "../../../../lib/renderShot";

// T2I must finish before I2V can be submitted (it needs the frame), so this
// route waits for the frame (Z-Image-Turbo, ~seconds) and returns once the
// video job is queued. Poll GET /api/shot/{videoJobId} for the result.
export const maxDuration = 300;

type Body = {
  prompt?: unknown;
  negative?: unknown;
  seed?: unknown;
  width?: unknown;
  height?: unknown;
  seconds?: unknown;
  aspect?: unknown;
};

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.prompt !== "string" || !body.prompt.trim())
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });

  const prompt = body.prompt.trim();
  const negative = typeof body.negative === "string" ? body.negative : undefined;
  const seed = typeof body.seed === "number" ? Math.floor(body.seed) : undefined;
  const aspect: Aspect = body.aspect === "9:16" ? "9:16" : DEFAULT_ASPECT;
  const size = RENDER_SIZE[aspect];
  const { width, height } = snapVideoSize(num(body.width, size.width), num(body.height, size.height));
  const seconds = Math.min(SHOT_SECONDS.max, Math.max(SHOT_SECONDS.min, Math.round(num(body.seconds, SHOT_SECONDS.default))));

  try {
    const frameJobId = await renderFirstFrame({ prompt, seed, width, height });
    const frame = await getFirstFrame(frameJobId, 4 * 60_000);
    const videoJobId = await renderShot({ prompt, negative, seed, width, height, seconds, imageRef: frame.assetId });
    return NextResponse.json({ frameJobId, videoJobId, frameUrl: frame.url, width, height, seconds });
  } catch (err) {
    const e = toRenderError(err);
    return NextResponse.json({ error: e.code, message: e.message }, { status: e.httpStatus });
  }
}
