import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ComfyError,
  Forbidden,
  InsufficientCredits,
  InvalidWorkflow,
  JobFailed,
  MissingAsset,
  MissingCredentials,
  NotFound,
  Unauthorized,
  type Job,
  type Output,
  type Workflow,
} from "@comfyorg/sdk";
import { getComfy } from "./comfy";
import { I2V, I2V_FILE, T2I, T2I_FILE, type NodeRef } from "./workflowMap";

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type RenderErrorCode =
  | "missing_node"
  | "missing_credentials"
  | "unauthorized"
  | "forbidden"
  | "insufficient_credits"
  | "timeout"
  | "job_failed"
  | "invalid_workflow"
  | "missing_asset"
  | "not_found"
  | "unknown";

export class RenderError extends Error {
  constructor(
    readonly code: RenderErrorCode,
    message: string,
    readonly httpStatus = 500,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "RenderError";
  }
}

/** Translate SDK / runtime errors into one clear RenderError. Never includes the API key. */
export function toRenderError(err: unknown): RenderError {
  if (err instanceof RenderError) return err;
  const reqId = err instanceof ComfyError && err.requestId ? ` (request id ${err.requestId})` : "";

  if (err instanceof MissingCredentials)
    return new RenderError("missing_credentials", "COMFY_API_KEY is not set. Comfy Cloud requires an API key.", 500);
  if (err instanceof Unauthorized)
    return new RenderError("unauthorized", `Comfy rejected the API key (401). Check COMFY_API_KEY is valid and not revoked${reqId}.`, 401);
  if (err instanceof Forbidden)
    return new RenderError(
      "forbidden",
      `Comfy refused the request (403 ${err.code ?? "forbidden"}: ${err.message}). The account/plan may not include API access, or the key lacks permission${reqId}.`,
      403,
      err.details,
    );
  if (err instanceof InsufficientCredits)
    return new RenderError("insufficient_credits", `Not enough Comfy credits to run this job (402). Top up the account${reqId}.`, 402);
  if (err instanceof JobFailed) {
    const e = err.error;
    const where = e?.node_id ? ` at node ${e.node_id}${e.class_type ? ` (${e.class_type})` : ""}` : "";
    return new RenderError("job_failed", `Comfy job failed${where}: ${e?.message ?? err.message}`, 502, e);
  }
  if (err instanceof InvalidWorkflow)
    return new RenderError("invalid_workflow", `Comfy rejected the workflow: ${err.message}`, 422, err.details);
  if (err instanceof MissingAsset)
    return new RenderError("missing_asset", `Input image asset was not usable: ${err.message}`, 422, err.details);
  if (err instanceof NotFound) return new RenderError("not_found", `Not found: ${err.message}`, 404);
  if (err instanceof Error && (err.name === "TimeoutError" || (err instanceof ComfyError && err.code === "request_timeout")))
    return new RenderError("timeout", `Timed out waiting for Comfy: ${err.message}`, 504);
  if (err instanceof ComfyError)
    return new RenderError("unknown", `Comfy error ${err.code ?? ""} ${err.httpStatus ?? ""}: ${err.message}${reqId}`.trim(), err.httpStatus ?? 500);
  return new RenderError("unknown", err instanceof Error ? err.message : String(err));
}

/* ------------------------------------------------------------------ */
/* Workflow helpers                                                    */
/* ------------------------------------------------------------------ */

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>;

const templates = new Map<string, Graph>();

function loadTemplate(file: string): Graph {
  let g = templates.get(file);
  if (!g) {
    g = JSON.parse(readFileSync(path.join(process.cwd(), file), "utf8")) as Graph;
    templates.set(file, g);
  }
  return structuredClone(g);
}

function set(wf: Workflow, ref: NodeRef, value: unknown, file: string) {
  const node = (wf.json as Graph)[ref.id];
  if (!node) throw new RenderError("missing_node", `${file}: node "${ref.id}" (${ref.classType}) not found. Re-check lib/workflowMap.ts.`);
  if (node.class_type !== ref.classType)
    throw new RenderError(
      "missing_node",
      `${file}: node "${ref.id}" is ${node.class_type}, expected ${ref.classType}. Re-check lib/workflowMap.ts.`,
    );
  if (!(ref.input in node.inputs))
    throw new RenderError("missing_node", `${file}: node "${ref.id}" has no input "${ref.input}".`);
  wf.setInput(ref.id, ref.input, value);
}

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 48);
}

/** LTX-2.3 I2V renders at W/2 x H/2 then upscales x2, so W and H must be multiples of 64. */
export function snapVideoSize(width: number, height: number) {
  const snap = (v: number) => Math.max(64, Math.round(v / 64) * 64);
  return { width: snap(width), height: snap(height) };
}

/* ------------------------------------------------------------------ */
/* Step 1: first frame (Z-Image-Turbo T2I)                             */
/* ------------------------------------------------------------------ */

export type FirstFrameInput = { prompt: string; seed?: number; width: number; height: number };

/** Submit the T2I job. Returns the Comfy job id immediately. */
export async function renderFirstFrame(input: FirstFrameInput): Promise<string> {
  try {
    const client = getComfy();
    const wf = client.workflows.fromJson(loadTemplate(T2I_FILE));
    set(wf, T2I.positive, input.prompt, T2I_FILE);
    set(wf, T2I.seed, input.seed ?? randomSeed(), T2I_FILE);
    set(wf, T2I.width, input.width, T2I_FILE);
    set(wf, T2I.height, input.height, T2I_FILE);
    set(wf, T2I.saveImage, "oneliner/frame", T2I_FILE);
    const job = await client.submit(wf);
    return job.id;
  } catch (err) {
    throw toRenderError(err);
  }
}

export type FirstFrame = { jobId: string; assetId: string; url: string; expiresAt: Date | null; output: Output };

/**
 * Wait for a T2I job and return its image. `assetId` is the imageRef to pass
 * to renderShot (the output is already a Comfy asset, so nothing is re-uploaded).
 */
export async function getFirstFrame(jobId: string, timeoutMs = 5 * 60_000): Promise<FirstFrame> {
  try {
    const job = await waitForJob(jobId, timeoutMs);
    const output = job.getOutputs(T2I.saveImage.id).find((o) => o.type === "image");
    if (!output) throw new RenderError("job_failed", `T2I job ${jobId} succeeded but node ${T2I.saveImage.id} produced no image.`, 502);
    const { url, expiresAt } = await output.getDownloadUrl();
    return { jobId, assetId: output.id, url, expiresAt, output };
  } catch (err) {
    throw toRenderError(err);
  }
}

/* ------------------------------------------------------------------ */
/* Step 2: shot (LTX-2.3 I2V)                                          */
/* ------------------------------------------------------------------ */

export type ShotInput = {
  prompt: string;
  negative?: string;
  seed?: number;
  width: number;
  height: number;
  /** Integer seconds (the workflow's Duration is an int). Frames = seconds * fps + 1. */
  seconds: number;
  /** Comfy asset id of the first frame (FirstFrame.assetId). */
  imageRef: string;
};

/** Clone the I2V workflow, set inputs, bind the first frame to LoadImage.image, submit. */
export async function renderShot(input: ShotInput): Promise<string> {
  try {
    const client = getComfy();
    const { width, height } = snapVideoSize(input.width, input.height);
    const seed = input.seed ?? randomSeed();
    const wf = client.workflows.fromJson(loadTemplate(I2V_FILE));

    set(wf, I2V.positive, input.prompt, I2V_FILE);
    if (input.negative !== undefined) set(wf, I2V.negative, input.negative, I2V_FILE);
    set(wf, I2V.noiseStage1, seed, I2V_FILE);
    set(wf, I2V.noiseStage2, seed + 1, I2V_FILE);
    set(wf, I2V.width, width, I2V_FILE);
    set(wf, I2V.height, height, I2V_FILE);
    set(wf, I2V.duration, Math.max(1, Math.round(input.seconds)), I2V_FILE);
    set(wf, I2V.t2vSwitch, false, I2V_FILE);
    set(wf, I2V.promptEnhance, false, I2V_FILE);
    set(wf, I2V.saveVideo, "oneliner/shot", I2V_FILE);

    // Rehydrate the T2I output as an asset handle; the SDK substitutes a
    // core/ASSET reference into LoadImage.image at submit time.
    const asset = await client.assets.get(input.imageRef);
    set(wf, I2V.image, asset, I2V_FILE);

    const job = await client.submit(wf);
    return job.id;
  } catch (err) {
    throw toRenderError(err);
  }
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export type JobStatus = {
  jobId: string;
  status: string; // queued | running | canceling | succeeded | canceled | failed | expired
  progress?: number;
  queuePosition?: number;
  /** Signed, self-authorising URL (Output.url itself needs auth). */
  outputUrl?: string;
  outputType?: string;
  outputExpiresAt?: string | null;
  error?: string;
  metrics?: Record<string, number | null>;
};

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  try {
    const job = await getComfy().jobs.get(jobId);
    const res: JobStatus = { jobId, status: job.status };
    if (job.progress) res.progress = job.progress.value;
    if (job.queuePosition !== null) res.queuePosition = job.queuePosition;
    if (job.metrics) res.metrics = job.metrics;
    if (job.status === "failed" && job.error) res.error = job.error.message;
    if (job.status === "succeeded") {
      const out = job.outputs.find((o) => o.type === "video") ?? job.outputs.find((o) => o.type === "image");
      if (out) {
        const { url, expiresAt } = await out.getDownloadUrl();
        res.outputUrl = url;
        res.outputType = out.type;
        res.outputExpiresAt = expiresAt?.toISOString() ?? null;
      }
    }
    return res;
  } catch (err) {
    throw toRenderError(err);
  }
}

/** Poll a job to a terminal state; throws RenderError on failure or timeout. */
export async function waitForJob(jobId: string, timeoutMs: number): Promise<Job> {
  try {
    const job = await getComfy().jobs.get(jobId);
    await job.wait(timeoutMs);
    if (job.status !== "succeeded") {
      const e = job.error;
      throw new RenderError(
        "job_failed",
        `Job ${jobId} ended ${job.status}${e ? `: ${e.message}${e.node_id ? ` (node ${e.node_id} ${e.class_type ?? ""})` : ""}` : ""}`,
        502,
        e,
      );
    }
    return job;
  } catch (err) {
    throw toRenderError(err);
  }
}
