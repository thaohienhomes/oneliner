import { NextResponse } from "next/server";
import { getJobStatus, toRenderError } from "../../../../../lib/renderShot";

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  try {
    return NextResponse.json(await getJobStatus(jobId));
  } catch (err) {
    const e = toRenderError(err);
    return NextResponse.json({ error: e.code, message: e.message }, { status: e.httpStatus });
  }
}
