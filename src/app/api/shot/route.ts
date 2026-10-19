import { NextResponse } from "next/server";
import { z } from "zod";
import { CONTENT_MESSAGE, contentViolation } from "../../../../lib/contentFilter";
import { demoJobId, demoMode } from "../../../../lib/demo";
import { clientIp, takeShotQuota } from "../../../../lib/quota";
import { RENDER_SIZE } from "../../../../lib/renderConfig";
import { getFirstFrame, renderFirstFrame, renderShot, snapVideoSize, toPublicError } from "../../../../lib/renderShot";
import { ShotRequestSchema } from "../../../../lib/shotRequest";
import { I2V_MAX_SIZE } from "../../../../lib/workflowMap";

// T2I must finish before I2V can be submitted (it needs the frame), so this
// route waits for the frame (Z-Image-Turbo, ~seconds) and returns once the
// video job is queued. Poll GET /api/shot/{videoJobId} for the result.
//
// Order matters (cost guard): validate -> content filter -> demo mode ->
// daily budget -> Comfy. A refused request never reaches Comfy.
export const maxDuration = 300;

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json", message: "Expected a JSON body." }, { status: 400 });
  }
  const parsed = ShotRequestSchema.safeParse(json);
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_request", message: z.prettifyError(parsed.error) }, { status: 400 });
  const r = parsed.data;

  const size = RENDER_SIZE[r.aspect];
  const { width, height } = snapVideoSize(r.width ?? size.width, r.height ?? size.height);
  if (width > I2V_MAX_SIZE.width || height > I2V_MAX_SIZE.height || width * height > I2V_MAX_SIZE.pixels)
    return NextResponse.json({ error: "invalid_request", message: `Resolution ${width}x${height} is above the max.` }, { status: 400 });

  if (contentViolation(r.prompt)) return NextResponse.json({ error: "content_blocked", message: CONTENT_MESSAGE }, { status: 422 });

  if (demoMode()) {
    // Pre-rendered samples: no Comfy, no credits, no budget used.
    const videoJobId = demoJobId(r.seed, r.prompt);
    return NextResponse.json({ frameJobId: videoJobId, videoJobId, width, height, seconds: r.seconds, demo: true });
  }

  let quota;
  try {
    quota = await takeShotQuota(clientIp(req.headers));
  } catch (err) {
    console.error("[shot] budget counter unavailable:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "budget_unavailable", message: "The studio is busy. Try again in a minute." }, { status: 503 });
  }
  if (!quota.ok) return NextResponse.json({ error: "daily_limit", scope: quota.scope, message: quota.message }, { status: 429 });

  try {
    const frameJobId = await renderFirstFrame({ prompt: r.prompt, seed: r.seed, width, height });
    const frame = await getFirstFrame(frameJobId, 4 * 60_000);
    const videoJobId = await renderShot({
      prompt: r.prompt,
      negative: r.negative,
      seed: r.seed,
      width,
      height,
      seconds: r.seconds,
      imageRef: frame.assetId,
    });
    return NextResponse.json({ frameJobId, videoJobId, frameUrl: frame.url, width, height, seconds: r.seconds });
  } catch (err) {
    const e = toPublicError(err, "shot");
    return NextResponse.json(e.body, { status: e.status });
  }
}
