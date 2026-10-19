/**
 * DEMO_MODE=1: play pre-rendered sample clips (public/samples/) instead of
 * calling Comfy. Fake job ids encode the sample and the start time so the
 * status route can show a short "rendering" phase without any server state.
 */
export const demoMode = () => ["1", "true"].includes(process.env.DEMO_MODE?.trim().toLowerCase() ?? "");

export const DEMO_SAMPLES = ["/samples/sample-1.mp4", "/samples/sample-2.mp4", "/samples/sample-3.mp4", "/samples/sample-4.mp4"];
export const DEMO_RENDER_MS = 5000;

const DEMO_ID = /^demo-(\d+)-([0-9a-z]+)$/;

export function demoJobId(seed: number | undefined, prompt: string, now = Date.now()) {
  let h = seed ?? 0;
  for (let i = 0; i < prompt.length; i++) h = (h * 31 + prompt.charCodeAt(i)) >>> 0;
  return `demo-${h % DEMO_SAMPLES.length}-${now.toString(36)}`;
}

export const isDemoJob = (id: string) => DEMO_ID.test(id);

export function demoStatus(id: string, now = Date.now()) {
  const m = DEMO_ID.exec(id);
  if (!m) return null;
  const elapsed = now - parseInt(m[2], 36);
  if (elapsed < DEMO_RENDER_MS) return { jobId: id, status: "running", progress: Math.max(0.05, elapsed / DEMO_RENDER_MS) };
  return { jobId: id, status: "succeeded", progress: 1, outputUrl: DEMO_SAMPLES[Number(m[1]) % DEMO_SAMPLES.length], outputType: "video/mp4" };
}

export function demoClipUrl(id: string) {
  const m = DEMO_ID.exec(id);
  return m ? DEMO_SAMPLES[Number(m[1]) % DEMO_SAMPLES.length] : null;
}
