/**
 * Minimal deterministic content filter for loglines and shot prompts. The LLM
 * system prompt carries the full content rules (lib/shotList.ts); this list
 * catches the obvious cases even when the mock provider (no LLM) is used.
 * Real names / brands / franchises are handled by lib/ipGuard.ts.
 */
const BLOCKED: RegExp[] = [
  /\b(porn\w*|nsfw|hentai|xxx)\b/i,
  /\b(nude|naked|nudity|topless|sex|sexual|erotic\w*|fetish)\b/i,
  /\b(child|kid|minor|teen|underage)\w*\b.*\b(sex\w*|nude|naked|erotic)\b/i,
  /\b(behead\w*|dismember\w*|disembowel\w*|gore|torture porn)\b/i,
  /\b(suicide|self[- ]harm)\b/i,
  /\b(swastika|white power|ethnic cleansing|genocide of)\b/i,
  /\b(how to (make|build) (a )?(bomb|explosive|meth|nerve agent))\b/i,
];

export const CONTENT_MESSAGE = "Let's keep it PG-13: that idea can't be filmed here. Try a different story.";

export function contentViolation(text: string): boolean {
  return BLOCKED.some((re) => re.test(text));
}
