import { NextResponse } from "next/server";
import { z } from "zod";
import { PublishError, PublishMetaSchema, publishTrailer, trailerStorage } from "../../../../lib/trailers";

// Body: multipart/form-data { meta: JSON string, video: MP4 file, poster: JPEG file }.
export const maxDuration = 60;

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_body", message: "Expected multipart form data." }, { status: 400 });
  }
  const video = form.get("video");
  const poster = form.get("poster");
  const rawMeta = form.get("meta");
  if (!(video instanceof Blob) || !(poster instanceof Blob) || typeof rawMeta !== "string")
    return NextResponse.json({ error: "invalid_body", message: "meta, video and poster are required." }, { status: 400 });

  let metaJson: unknown;
  try {
    metaJson = JSON.parse(rawMeta);
  } catch {
    return NextResponse.json({ error: "invalid_meta", message: "meta is not JSON." }, { status: 400 });
  }
  const parsed = PublishMetaSchema.safeParse(metaJson);
  if (!parsed.success) return NextResponse.json({ error: "invalid_meta", message: z.prettifyError(parsed.error) }, { status: 400 });

  try {
    const trailer = await publishTrailer({
      meta: parsed.data,
      video: new Uint8Array(await video.arrayBuffer()),
      poster: new Uint8Array(await poster.arrayBuffer()),
    });
    return NextResponse.json({ id: trailer.id, url: `/t/${trailer.id}`, videoUrl: trailer.videoUrl, storage: trailerStorage().kind });
  } catch (err) {
    if (err instanceof PublishError) return NextResponse.json({ error: "publish_rejected", message: err.message }, { status: err.httpStatus });
    console.error("publish failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "publish_failed", message: "Could not save the trailer. Try again." }, { status: 500 });
  }
}
