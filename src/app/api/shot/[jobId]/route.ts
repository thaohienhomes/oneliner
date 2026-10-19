import { NextResponse } from "next/server";
import { demoStatus, isDemoJob } from "../../../../../lib/demo";
import { getJobStatus, toPublicError } from "../../../../../lib/renderShot";

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (isDemoJob(jobId)) return NextResponse.json(demoStatus(jobId));
  try {
    const st = await getJobStatus(jobId);
    // Failed-job details (node ids, raw messages) stay in the server log.
    if (st.error) {
      console.error(`[shot status] ${jobId}: ${st.error}`);
      st.error = "Comfy couldn't finish this shot. Hit Retry, or tweak the shot and re-render.";
    }
    return NextResponse.json(st);
  } catch (err) {
    const e = toPublicError(err, "shot status");
    return NextResponse.json(e.body, { status: e.status });
  }
}
