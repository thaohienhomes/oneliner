import { NextResponse } from "next/server";
import { demoClipUrl, isDemoJob } from "../../../../../../lib/demo";
import { rehostClip } from "../../../../../../lib/rehost";
import { toPublicError } from "../../../../../../lib/renderShot";

// Downloads the finished clip from Comfy and stores it (Blob or public/renders/).
export const maxDuration = 120;

export async function POST(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (isDemoJob(jobId)) return NextResponse.json({ url: demoClipUrl(jobId), storage: "local", contentType: "video/mp4", sizeBytes: -1 });
  try {
    return NextResponse.json(await rehostClip(jobId));
  } catch (err) {
    const e = toPublicError(err, "rehost");
    return NextResponse.json(e.body, { status: e.status });
  }
}
