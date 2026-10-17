/**
 * Node-ID map for the two API-format workflows in /workflows.
 *
 * Every ID below was read from the exported JSON (class_type + _meta.title),
 * not guessed. If Tom re-exports a workflow, IDs may change: renderShot.ts
 * validates each one (ID exists + class_type matches) before submitting.
 */

export type NodeRef = { id: string; classType: string; input: string };

/* ------------------------------------------------------------------ */
/* workflows/zimage_t2i_api.json — Z-Image-Turbo: Text to Image        */
/* ------------------------------------------------------------------ */
export const T2I_FILE = "workflows/zimage_t2i_api.json";

export const T2I = {
  // "57:27" CLIPTextEncode, title "CLIP Text Encode (Prompt)" -> KSampler.positive
  positive: { id: "57:27", classType: "CLIPTextEncode", input: "text" },
  // "57:3" KSampler, title "KSampler" (steps 8, cfg 1, res_multistep)
  seed: { id: "57:3", classType: "KSampler", input: "seed" },
  // "57:13" EmptySD3LatentImage, title "EmptySD3LatentImage" (default 1024x1024)
  width: { id: "57:13", classType: "EmptySD3LatentImage", input: "width" },
  height: { id: "57:13", classType: "EmptySD3LatentImage", input: "height" },
  // "9" SaveImage, title "Save Image" — output node to read the PNG from
  saveImage: { id: "9", classType: "SaveImage", input: "filename_prefix" },
  // Negative prompt: NONE. KSampler.negative is "57:33" ConditioningZeroOut
  // (zeroed positive, cfg=1) — Z-Image-Turbo has no negative text field.
} as const satisfies Record<string, NodeRef>;

/* ------------------------------------------------------------------ */
/* workflows/ltx23_i2v_api.json — LTX-2.3: Image to Video (with audio) */
/* ------------------------------------------------------------------ */
export const I2V_FILE = "workflows/ltx23_i2v_api.json";

export const I2V = {
  // "269" LoadImage, title "Load Image" — `image` is a filename widget; we bind
  // a Comfy asset handle here (SDK substitutes a core/ASSET reference).
  image: { id: "269", classType: "LoadImage", input: "image" },
  // "320:319" PrimitiveStringMultiline, title "Prompt". Feeds the
  // "320:327" If/Else Switch (on_false) -> "320:303" CLIPTextEncode (positive).
  positive: { id: "320:319", classType: "PrimitiveStringMultiline", input: "value" },
  // "320:313" CLIPTextEncode (title "CLIP Text Encode (Prompt)") wired to
  // "320:304" LTXVConditioning.negative -> negative prompt text.
  negative: { id: "320:313", classType: "CLIPTextEncode", input: "text" },
  // Two RandomNoise nodes (title "RandomNoise"):
  //   "320:277" -> "320:283" SamplerCustomAdvanced (stage 1, half-res base pass)
  //   "320:276" -> "320:308" SamplerCustomAdvanced (stage 2, after x2 latent upscale)
  noiseStage1: { id: "320:277", classType: "RandomNoise", input: "noise_seed" },
  noiseStage2: { id: "320:276", classType: "RandomNoise", input: "noise_seed" },
  // "320:312" PrimitiveInt title "Width", "320:299" PrimitiveInt title "Height".
  // Final output size. Stage 1 latent is Width/2 x Height/2 ("320:292"/"320:294"
  // Math Expression a/2), then "320:287" LTXVLatentUpsampler x2.
  // => Width/2 and Height/2 must be multiples of 32 (Width, Height multiples of 64).
  width: { id: "320:312", classType: "PrimitiveInt", input: "value" },
  height: { id: "320:299", classType: "PrimitiveInt", input: "value" },
  // "320:301" PrimitiveInt title "Duration" (integer seconds).
  // Frame count is derived: "320:323" Math Expression (length) = Duration * FPS + 1.
  duration: { id: "320:301", classType: "PrimitiveInt", input: "value" },
  // "320:300" PrimitiveInt title "Frame Rate" (default 25) -> CreateVideo.fps,
  // LTXVConditioning.frame_rate, LTXVEmptyLatentAudio.frame_rate.
  fps: { id: "320:300", classType: "PrimitiveInt", input: "value" },
  // "320:302" PrimitiveBoolean title "Switch to Text to Video?" (false = I2V).
  t2vSwitch: { id: "320:302", classType: "PrimitiveBoolean", input: "value" },
  // "320:328" PrimitiveBoolean title "Boolean (Enable Prompt Enhance)" (false).
  // When true, "320:325" TextGenerateLTX2Prompt (Gemma) rewrites the prompt.
  promptEnhance: { id: "320:328", classType: "PrimitiveBoolean", input: "value" },
  // "75" SaveVideo, title "Save Video" (format/codec "auto") — output node.
  saveVideo: { id: "75", classType: "SaveVideo", input: "filename_prefix" },
} as const satisfies Record<string, NodeRef>;

/**
 * LTX-2.3 outputs AUDIO: "320:305" LTXVEmptyLatentAudio + "320:297"
 * LTXVAudioVAEDecode feed "320:310" CreateVideo.audio, so the saved video
 * carries a generated audio track alongside the frames.
 */
export const I2V_HAS_AUDIO = true;

/** Things the task asked for that do not exist as a settable input. */
export const UNKNOWNS: string[] = [
  "T2I negative prompt: none (57:33 ConditioningZeroOut, cfg=1).",
  "I2V frame count: not a direct input; derived as Duration*FPS+1 by 320:323 (Duration is integer seconds).",
  "I2V `length` LTX 8n+1 rounding: not visible in the graph; the server-side nodes handle a non-8n+1 length.",
  "Cost/credits per job: the v2 Job contract has no cost field (only metrics like queue_ms/execution_ms).",
];
