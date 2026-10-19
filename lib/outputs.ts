/**
 * Output pickers for finished Comfy jobs.
 *
 * Comfy Cloud labels SaveVideo outputs `type: "image"` even when the file is
 * an mp4 (content_type "video/mp4"), so `type` alone can't be trusted. Pick by
 * content_type first, then file extension, then `type`.
 */

/** The fields we read from an SDK Output (structural, so tests can pass plain objects). */
export type OutputLike = { nodeId: string; name: string; type: string; contentType: string };

const VIDEO_EXT = /\.(mp4|webm|mov|mkv)$/i;

const isVideoMime = (o: OutputLike) => (o.contentType ?? "").toLowerCase().startsWith("video/");
const hasVideoExt = (o: OutputLike) => VIDEO_EXT.test(o.name ?? "");
export const isVideoOutput = (o: OutputLike) => isVideoMime(o) || hasVideoExt(o) || o.type === "video";

/**
 * Pick the video clip from a job's outputs. Prefers outputs from `nodeId`
 * (the SaveVideo node), then any node. Within each pool: content_type
 * video/*, then a .mp4/.webm name, then type === "video".
 */
export function pickVideoOutput<T extends OutputLike>(outputs: readonly T[], nodeId?: string): T | undefined {
  const pools = nodeId ? [outputs.filter((o) => o.nodeId === nodeId), outputs] : [outputs];
  for (const pool of pools) {
    const hit = pool.find(isVideoMime) ?? pool.find(hasVideoExt) ?? pool.find((o) => o.type === "video");
    if (hit) return hit;
  }
  return undefined;
}

/** Pick a still image (T2I frame), ignoring anything that is actually a video. */
export function pickImageOutput<T extends OutputLike>(outputs: readonly T[]): T | undefined {
  return outputs.find((o) => o.type === "image" && !isVideoOutput(o));
}
