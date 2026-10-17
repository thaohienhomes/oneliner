/**
 * Logline -> shot list. Server-only (imports the AI SDK).
 *
 * Provider: any OpenAI-compatible Chat Completions endpoint configured by
 * LLM_BASE_URL / LLM_MODEL / LLM_API_KEY (OpenAI, or Qwen/Llama on Together,
 * Groq, OpenRouter, vLLM, ...). Falls back to a deterministic mock when
 * LLM_API_KEY is empty or LLM_MOCK=1, so the app works with no key.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { extractJsonMiddleware, generateText, Output, wrapLanguageModel } from "ai";
import { z } from "zod";
import { guardIP, shortName, type Replacement } from "./ipGuard";
import { MAX_TOTAL_SECONDS, SHOT_COUNT, SHOT_SECONDS, type Aspect } from "./renderConfig";
import {
  CAMERA_MOVES,
  LENSES,
  SHOT_TYPES,
  ShotListDraftSchema,
  ShotListSchema,
  type Shot,
  type ShotList,
} from "./shot";

export { shotToPrompt } from "./shot";
export type { Shot, ShotList } from "./shot";

export type Provider = "mock" | "llm";
export type ShotListResult = ShotList & { provider: Provider; replacements: Replacement[] };

export function activeProvider(): Provider {
  const mock = process.env.LLM_MOCK?.trim().toLowerCase();
  if (mock === "1" || mock === "true") return "mock";
  return process.env.LLM_API_KEY?.trim() ? "llm" : "mock";
}

export class ShotListError extends Error {
  constructor(
    message: string,
    readonly httpStatus = 502,
  ) {
    super(message);
    this.name = "ShotListError";
  }
}

/* ------------------------------------------------------------------ */
/* Prompting                                                           */
/* ------------------------------------------------------------------ */

export const SYSTEM_PROMPT = `You are a film trailer director. Turn a one-sentence logline into a short teaser shot list for an AI video model.

Rules:
- ORIGINAL CHARACTERS ONLY. Never use real people, celebrities, politicians, brands, logos, or copyrighted franchises/characters/places (e.g. Batman, Marvel, Star Wars, Pokemon, Disney). If the logline names one, silently replace it with an original equivalent with a new name and a distinct look, and use that replacement everywhere (title, tagline, shots).
- ${SHOT_COUNT.min}-${SHOT_COUNT.max} shots. Each shot is a whole number of seconds from ${SHOT_SECONDS.min} to ${SHOT_SECONDS.max}. Total of all shots <= ${MAX_TOTAL_SECONDS} seconds.
- shotType is one of: ${SHOT_TYPES.join(", ")}.
- lens is one of: ${LENSES.join(", ")}.
- cameraMove is one of: ${CAMERA_MOVES.join(", ")}.
- action: exactly one vivid, visual sentence describing who/what is on screen and what physically happens. Describe characters by appearance; no dialogue, no on-screen text.
- mood: 2-5 words.
- Vary shot sizes and moves like a real trailer: establish the world, introduce the hero, raise the stakes, end on a striking button shot.
- title: a short original trailer title. tagline: one punchy line.
Respond with JSON only.`;

function llmModel() {
  const model = process.env.LLM_MODEL?.trim();
  if (!model) throw new ShotListError("LLM_MODEL is not set (required when LLM_API_KEY is set).", 500);
  const provider = createOpenAI({
    name: "llm",
    apiKey: process.env.LLM_API_KEY?.trim(),
    baseURL: process.env.LLM_BASE_URL?.trim() || undefined,
  });
  // Chat Completions (not Responses API) = the widest OpenAI-compatible surface.
  return wrapLanguageModel({ model: provider.chat(model), middleware: extractJsonMiddleware() });
}

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

type Draft = z.infer<typeof ShotListDraftSchema>;

/** Assign ids, clamp to whole seconds, trim to the 13s budget, re-apply the IP guard. */
export function finalizeDraft(draft: Draft, seedReplacements: Replacement[] = []): ShotList & { replacements: Replacement[] } {
  const replacements = [...seedReplacements];
  const guard = (s: string) => {
    const g = guardIP(s);
    for (const r of g.replacements) if (!replacements.some((x) => x.from.toLowerCase() === r.from.toLowerCase())) replacements.push(r);
    return g.text;
  };

  const shots: Shot[] = draft.shots.slice(0, SHOT_COUNT.max).map((s, i) => ({
    ...s,
    id: `shot-${i + 1}-${hash(`${draft.title}|${s.action}|${i}`).toString(36)}`,
    seconds: Math.min(SHOT_SECONDS.max, Math.max(SHOT_SECONDS.min, Math.round(s.seconds))),
    action: guard(s.action),
    mood: guard(s.mood),
  }));

  // Over budget: shave a second off the longest shot until it fits (6 x 2s = 12s always fits).
  let total = shots.reduce((t, s) => t + s.seconds, 0);
  while (total > MAX_TOTAL_SECONDS) {
    const longest = shots.reduce((a, b) => (b.seconds > a.seconds ? b : a));
    longest.seconds -= 1;
    total -= 1;
  }

  const list = { title: guard(draft.title), tagline: guard(draft.tagline), shots };
  const parsed = ShotListSchema.safeParse(list);
  if (!parsed.success) throw new ShotListError(`Shot list failed validation: ${z.prettifyError(parsed.error)}`);
  return { ...parsed.data, replacements };
}

/* ------------------------------------------------------------------ */
/* Mock provider (deterministic)                                       */
/* ------------------------------------------------------------------ */

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const pick = <T>(arr: readonly T[], n: number) => arr[n % arr.length];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "A retired robot opens a noodle shop on Mars" -> { subject: "the retired robot", place: "Mars" }. */
function parseLogline(logline: string, replacements: Replacement[]) {
  const clean = logline.trim().replace(/[.!?]+$/, "");
  let subject = "the hero";
  if (replacements.length) subject = shortName(replacements[0].to);
  else {
    const m = clean.match(/^(?:an?|the)\s+(.+?)\s+\w+s\b/i);
    if (m && m[1].split(/\s+/).length <= 5) subject = `the ${m[1].toLowerCase()}`;
  }
  const place = clean.match(/\b(?:on|in|at|across|beneath|under|inside)\s+((?:the\s+)?[\w'-]+(?:\s+[\w'-]+)?)$/i)?.[1];
  return { sentence: `${cap(clean)}.`, subject, place };
}

const MOODS = [
  ["vast, lonely, quiet", "curious, tender", "tense, urgent", "frantic, chaotic", "hopeful, warm"],
  ["eerie, mysterious", "wistful, intimate", "ominous, building dread", "epic, thrilling", "triumphant, awe"],
  ["dreamlike, strange", "cozy, nostalgic", "dark, tense", "energetic, action", "quietly hopeful"],
] as const;
const TAGLINES = [
  "Every legend starts with one small step.",
  "Some dreams are worth crossing worlds for.",
  "The quiet ones always surprise you.",
  "Nothing about this will be easy.",
] as const;
const TITLES = ["{p}", "Last Light on {p}", "Far From {p}", "The {p} Job"] as const;

export function mockShotList(logline: string, aspect: Aspect): ShotList & { replacements: Replacement[] } {
  const { text, replacements } = guardIP(logline);
  const { sentence, subject, place } = parseLogline(text, replacements);
  const h = hash(`${logline}|${aspect}`);
  const moods = pick(MOODS, h);
  const Subject = cap(subject);
  const titleWord = place ? place.replace(/^the\s+/i, "").replace(/\b\w/g, (c) => c.toUpperCase()) : cap(shortName(subject).replace(/^the\s+/i, ""));

  const draft: Draft = {
    title: pick(TITLES, h >>> 3).replace("{p}", titleWord),
    tagline: pick(TAGLINES, h >>> 5),
    shots: [
      { shotType: "extreme wide", lens: "14mm", cameraMove: "crane down", mood: moods[0], action: sentence, seconds: 3 },
      { shotType: "medium", lens: "35mm", cameraMove: "dolly in", mood: moods[1], action: `${Subject} pauses and takes in the moment, eyes catching the light.`, seconds: 2 },
      { shotType: "close-up", lens: "85mm", cameraMove: "handheld", mood: moods[2], action: `${Subject}'s hands work with quiet determination as something starts to go wrong.`, seconds: 3 },
      { shotType: "wide", lens: "24mm", cameraMove: pick(["whip pan", "orbit", "truck left"] as const, h >>> 7), mood: moods[3], action: `Everything erupts at once as ${subject} races to hold it all together.`, seconds: 2 },
      { shotType: "close-up", lens: "50mm", cameraMove: "dolly out", mood: moods[4], action: `${Subject} looks up with a small, defiant smile as the light fades to black.`, seconds: 3 },
    ],
  };
  return finalizeDraft(draft, replacements);
}

const MOCK_ALT_ACTIONS = [
  "{S} steps into frame, silhouetted against a blaze of light.",
  "A gust of wind scatters dust as {s} turns sharply toward a distant sound.",
  "{S} grips a worn keepsake and makes a silent decision.",
  "The ground trembles and {s} braces against the nearest wall.",
  "{S} walks away from camera into a sea of drifting lights.",
] as const;

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function generateShotList(logline: string, aspect: Aspect): Promise<ShotListResult> {
  const provider = activeProvider();
  if (provider === "mock") return { provider, ...mockShotList(logline, aspect) };

  // Guard the logline before the model sees it; the system prompt covers the rest.
  const guarded = guardIP(logline);
  const orientation = aspect === "9:16" ? "vertical 9:16 (frame for portrait, subjects centered)" : "horizontal 16:9 widescreen";
  try {
    const { output } = await generateText({
      model: llmModel(),
      system: SYSTEM_PROMPT,
      prompt: `Logline: ${guarded.text}\nAspect: ${orientation}`,
      output: Output.object({ schema: ShotListDraftSchema, name: "shot_list" }),
      temperature: 0.8,
      maxRetries: 1,
    });
    return { provider, ...finalizeDraft(output, guarded.replacements) };
  } catch (err) {
    if (err instanceof ShotListError) throw err;
    throw new ShotListError(`LLM shot list failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Rewrite just the action sentence of one shot. */
export async function regenerateShotAction(input: {
  logline: string;
  shot: Pick<Shot, "shotType" | "lens" | "cameraMove" | "mood" | "action">;
  index: number;
  variant?: number;
}): Promise<{ provider: Provider; action: string; replacements: Replacement[] }> {
  const provider = activeProvider();
  const guarded = guardIP(input.logline);

  if (provider === "mock") {
    const { subject } = parseLogline(guarded.text, guarded.replacements);
    const tpl = pick(MOCK_ALT_ACTIONS, hash(input.logline) + input.index + (input.variant ?? 0));
    return { provider, action: tpl.replace("{S}", cap(subject)).replace("{s}", subject), replacements: guarded.replacements };
  }

  try {
    const { output } = await generateText({
      model: llmModel(),
      system: SYSTEM_PROMPT,
      prompt: `Logline: ${guarded.text}\nRewrite ONLY the action sentence for shot ${input.index + 1} (${input.shot.shotType}, ${input.shot.lens}, ${input.shot.cameraMove}, mood: ${input.shot.mood}). Make it different from: "${input.shot.action}". One sentence.`,
      output: Output.object({ schema: z.object({ action: z.string().min(1).max(300) }), name: "shot_action" }),
      temperature: 1,
      maxRetries: 1,
    });
    const g = guardIP(output.action);
    return { provider, action: g.text, replacements: [...guarded.replacements, ...g.replacements] };
  } catch (err) {
    throw new ShotListError(`LLM shot rewrite failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
