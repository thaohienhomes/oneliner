import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";
import { getComfy } from "./comfy";
import { pickVideoOutput } from "./outputs";
import { RenderError, toRenderError } from "./renderShot";
import { I2V } from "./workflowMap";

/**
 * Copy a finished clip off Comfy's ~6h signed URL onto storage we own:
 * Vercel Blob when BLOB_READ_WRITE_TOKEN is set, else public/renders/ (local
 * dev; gitignored). Keyed by job id, so calling it twice is idempotent.
 */

export type RehostResult = { url: string; storage: "blob" | "local"; contentType: string; sizeBytes: number };

const JOB_ID = /^[0-9a-f][0-9a-f-]{7,63}$/i;
const LOCAL_DIR = path.join(process.cwd(), "public", "renders");
const EXT_MIME: Record<string, string> = { mp4: "video/mp4", webm: "video/webm" };

export const blobEnabled = () => !!process.env.BLOB_READ_WRITE_TOKEN?.trim();

export async function rehostClip(jobId: string): Promise<RehostResult> {
  if (!JOB_ID.test(jobId)) throw new RenderError("not_found", `Invalid job id "${jobId}".`, 400);

  if (!blobEnabled()) {
    for (const ext of Object.keys(EXT_MIME)) {
      if (existsSync(path.join(LOCAL_DIR, `${jobId}.${ext}`)))
        return { url: `/renders/${jobId}.${ext}`, storage: "local", contentType: EXT_MIME[ext], sizeBytes: -1 };
    }
  }

  try {
    const job = await getComfy().jobs.get(jobId);
    if (job.status !== "succeeded")
      throw new RenderError("job_failed", `Job ${jobId} is ${job.status}; only succeeded jobs can be re-hosted.`, 409);
    const out = pickVideoOutput(job.outputs, I2V.saveVideo.id);
    if (!out) throw new RenderError("job_failed", `Job ${jobId} has no video output.`, 502);

    const ext = /\.webm$/i.test(out.name) || out.contentType === "video/webm" ? "webm" : "mp4";
    const contentType = out.contentType?.startsWith("video/") ? out.contentType : EXT_MIME[ext];
    const bytes = Buffer.from(await out.toBytes({ timeoutMs: 120_000 }));
    const file = `${jobId}.${ext}`;

    if (blobEnabled()) {
      const blob = await put(`renders/${file}`, bytes, { access: "public", contentType, addRandomSuffix: false, allowOverwrite: true });
      return { url: blob.url, storage: "blob", contentType, sizeBytes: bytes.length };
    }
    await mkdir(LOCAL_DIR, { recursive: true });
    await writeFile(path.join(LOCAL_DIR, file), bytes);
    return { url: `/renders/${file}`, storage: "local", contentType, sizeBytes: bytes.length };
  } catch (err) {
    throw toRenderError(err);
  }
}
