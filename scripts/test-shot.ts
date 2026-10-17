/**
 * One end-to-end shot through Comfy (Cloud by default). SPENDS PAID CREDITS.
 *   npx tsx scripts/test-shot.ts
 * Z-Image-Turbo T2I -> out/test-frame.png -> LTX-2.3 I2V -> out/test-shot.mp4
 */
import { mkdirSync } from "node:fs";
import { comfyTarget } from "../lib/comfy";
import { getFirstFrame, renderFirstFrame, renderShot, snapVideoSize, waitForJob, RenderError } from "../lib/renderShot";
import { I2V, I2V_HAS_AUDIO, T2I, UNKNOWNS } from "../lib/workflowMap";

const PROMPT = "slow dolly-in on a lighthouse at dusk, 35mm, moody";
const NEGATIVE = "pc game, console game, video game, cartoon, childish, ugly, blurry, low quality";
const REQUESTED = { width: 768, height: 432 };
const SECONDS = 3;
const SEED = 20261017;

const t = () => performance.now();
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

async function main() {
  // 768x432 is not valid for this LTX-2.3 graph (half-res stage needs multiples of 32).
  const { width, height } = snapVideoSize(REQUESTED.width, REQUESTED.height);
  console.log(`Target: ${comfyTarget()}`);
  console.log(`Size: requested ${REQUESTED.width}x${REQUESTED.height} -> using ${width}x${height}`);
  console.log(`T2I nodes: ${Object.entries(T2I).map(([k, v]) => `${k}=${v.id}`).join(" ")}`);
  console.log(`I2V nodes: ${Object.entries(I2V).map(([k, v]) => `${k}=${v.id}`).join(" ")}`);
  console.log(`I2V outputs audio: ${I2V_HAS_AUDIO}`);
  console.log(`Unknowns:\n  - ${UNKNOWNS.join("\n  - ")}`);
  mkdirSync("out", { recursive: true });

  const t0 = t();
  const frameJobId = await renderFirstFrame({ prompt: PROMPT, seed: SEED, width, height });
  console.log(`\n[T2I] job id: ${frameJobId}`);
  const frame = await getFirstFrame(frameJobId);
  await frame.output.toFile("out/test-frame.png");
  const t1 = t();
  const frameJob = await waitForJob(frameJobId, 10_000);
  console.log(`[T2I] done in ${secs(t1 - t0)} -> out/test-frame.png (${frame.output.sizeBytes} bytes, asset ${frame.assetId})`);
  console.log(`[T2I] metrics: ${JSON.stringify(frameJob.metrics ?? null)}`);

  const shotJobId = await renderShot({
    prompt: PROMPT,
    negative: NEGATIVE,
    seed: SEED,
    width,
    height,
    seconds: SECONDS,
    imageRef: frame.assetId,
  });
  console.log(`\n[I2V] job id: ${shotJobId}`);
  const shotJob = await waitForJob(shotJobId, 20 * 60_000);
  const video = shotJob.getOutputs(I2V.saveVideo.id).find((o) => o.type === "video") ?? shotJob.outputs.find((o) => o.type === "video");
  if (!video) throw new RenderError("job_failed", `I2V job ${shotJobId} produced no video output.`);
  await video.toFile("out/test-shot.mp4");
  const t2 = t();
  console.log(`[I2V] done in ${secs(t2 - t1)} -> out/test-shot.mp4 (${video.sizeBytes} bytes, ${video.contentType})`);
  console.log(`[I2V] metrics: ${JSON.stringify(shotJob.metrics ?? null)}`);
  const { expiresAt } = await video.getDownloadUrl();
  console.log(`[I2V] signed download URL obtained (expires ${expiresAt?.toISOString() ?? "unknown"})`);

  console.log(`\nTotal: ${secs(t2 - t0)}`);
  console.log("Cost/credits: not returned by the Comfy API v2 job response (check the Comfy Cloud dashboard).");
}

main().catch((err) => {
  if (err instanceof RenderError)
    console.error(`\nFAILED [${err.code}] ${err.message}${err.details ? `\ndetails: ${JSON.stringify(err.details)}` : ""}`);
  else console.error("\nFAILED", err);
  process.exit(1);
});
