import { NextResponse } from "next/server";
import { rehostClip } from "../../../../../../lib/rehost";
import { toRenderError } from "../../../../../../lib/renderShot";

// Downloads the finished clip from Comfy and stores it (Blob or public/renders/).
export const maxDuration = 120;

export async function POST(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  try {
    return NextResponse.json(await rehostClip(jobId));
  } catch (err) {
    const e = toRenderError(err);
    return NextResponse.json({ error: e.code, message: e.message }, { status: e.httpStatus });
  }
}
