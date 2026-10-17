import { NextResponse } from "next/server";
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
  const { width, height } = snapVideoSize(num(body.width, 768), num(body.height, 448));
  const seconds = Math.min(10, Math.max(1, Math.round(num(body.seconds, 3))));

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
