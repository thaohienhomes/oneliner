/**
 * Shot preset vocabularies + shotToPrompt. Zod-free so the editor UI can
 * import it without pulling the schema library into the client bundle.
 */

export const SHOT_TYPES = ["extreme wide", "wide", "medium", "close-up", "extreme close-up", "insert"] as const;
export const LENSES = ["14mm", "24mm", "35mm", "50mm", "85mm", "135mm"] as const;
export const CAMERA_MOVES = [
  "static",
  "dolly in",
  "dolly out",
  "truck left",
  "truck right",
  "crane up",
  "crane down",
  "orbit",
  "handheld",
  "whip pan",
] as const;

export type ShotType = (typeof SHOT_TYPES)[number];
export type Lens = (typeof LENSES)[number];
export type CameraMove = (typeof CAMERA_MOVES)[number];

export type ShotPromptFields = { shotType: ShotType; lens: Lens; cameraMove: CameraMove; mood: string; action: string };

export function totalSeconds(shots: { seconds: number }[]) {
  return shots.reduce((s, x) => s + x.seconds, 0);
}

/** Horizontal FOV on a full-frame (36mm) sensor, rounded. Used for UI hints. */
export const LENS_FOV: Record<Lens, number> = {
  "14mm": 104,
  "24mm": 74,
  "35mm": 54,
  "50mm": 40,
  "85mm": 24,
  "135mm": 15,
};

const SHOT_TYPE_TEXT: Record<ShotType, string> = {
  "extreme wide": "Extreme wide establishing shot",
  wide: "Wide shot",
  medium: "Medium shot",
  "close-up": "Close-up",
  "extreme close-up": "Extreme close-up",
  insert: "Insert detail shot",
};

const LENS_TEXT: Record<Lens, string> = {
  "14mm": "14mm ultra-wide lens, exaggerated perspective, deep focus",
  "24mm": "24mm wide-angle lens, expansive depth",
  "35mm": "35mm lens, natural perspective",
  "50mm": "50mm lens, neutral human-eye perspective",
  "85mm": "85mm portrait lens, shallow depth of field, creamy bokeh",
  "135mm": "135mm telephoto lens, compressed background, very shallow focus",
};

const MOVE_TEXT: Record<CameraMove, string> = {
  static: "locked-off static camera",
  "dolly in": "slow dolly in toward the subject",
  "dolly out": "slow dolly out revealing the space",
  "truck left": "camera trucks left alongside the action",
  "truck right": "camera trucks right alongside the action",
  "crane up": "camera cranes up and rises above the scene",
  "crane down": "camera cranes down into the scene",
  orbit: "camera orbits around the subject",
  handheld: "handheld camera with subtle organic shake",
  "whip pan": "fast whip pan with motion blur",
};

/** Mood keywords -> lighting. First match wins; falls back to a neutral cinematic look. */
const LIGHTING_RULES: [RegExp, string][] = [
  [/dark|menac|dread|ominous|sinister|fear|horror|tense/i, "low-key lighting, hard shadows, cold rim light"],
  [/lonely|melanchol|sad|grief|quiet|somber|wistful/i, "soft overcast light, muted palette, gentle haze"],
  [/warm|cozy|hope|tender|nostalg|gentle/i, "warm golden practical light, soft glow"],
  [/epic|triumph|heroic|grand|awe/i, "golden-hour backlight, volumetric light rays"],
  [/myster|eerie|strange|uncanny|dream/i, "moody blue moonlight, drifting fog"],
  [/frantic|chaos|action|urgent|thrill|energetic/i, "high-contrast flashing light, sparks and haze"],
  [/funny|comic|playful|whimsic|quirky/i, "bright saturated light, playful colors"],
];

export function lightingForMood(mood: string) {
  return LIGHTING_RULES.find(([re]) => re.test(mood))?.[1] ?? "motivated cinematic lighting, gentle contrast";
}

/** Build the LTX prompt for one shot in cinematic language. */
export function shotToPrompt(shot: ShotPromptFields): string {
  const action = shot.action.trim().replace(/\s+/g, " ");
  const sentence = /[.!?]$/.test(action) ? action : `${action}.`;
  const mood = shot.mood.trim();
  return [
    `${SHOT_TYPE_TEXT[shot.shotType]}, ${LENS_TEXT[shot.lens]}, ${MOVE_TEXT[shot.cameraMove]}.`,
    sentence,
    `Lighting: ${lightingForMood(mood)}.`,
    mood ? `Mood: ${mood}.` : "",
    "Cinematic film trailer, anamorphic look, fine film grain, original characters.",
  ]
    .filter(Boolean)
    .join(" ");
}
