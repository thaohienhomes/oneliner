/**
 * Deterministic IP guard: swaps well-known franchises, characters, real people,
 * and brands for original stand-ins. Runs on the logline before ANY provider
 * (mock or LLM) sees it, and again on the generated text, so the rule holds
 * even if a model ignores the system prompt. The LLM system prompt covers
 * names not on this list.
 */

export type Replacement = { from: string; to: string };

// [pattern, original replacement]. Order matters: longer/more specific first.
const RULES: [RegExp, string][] = [
  // Franchise characters
  [/\bbat-?man\b/gi, "the Nightwarden, an original masked vigilante in a scalloped charcoal cape"],
  [/\bbruce wayne\b/gi, "a reclusive heir"],
  [/\bthe joker\b|\bjoker\b/gi, "the Grinning Anarchist"],
  [/\bgotham( city)?\b/gi, "Harbor Hollow"],
  [/\bsuper-?man\b/gi, "the Skyborne, an original flying hero"],
  [/\bspider-?man\b/gi, "the Silkrunner, an original wall-climbing hero"],
  [/\biron-?man\b/gi, "an original armored inventor-hero"],
  [/\b(the )?avengers\b/gi, "an original team of heroes"],
  [/\bmarvel\b|\bdc comics\b/gi, "an original comic-book world"],
  [/\bharry potter\b/gi, "a young orphan wizard named Wren"],
  [/\bhogwarts\b/gi, "an old academy of magic"],
  [/\bdarth vader\b/gi, "a masked fallen knight"],
  [/\bstar wars\b/gi, "an original space saga"],
  [/\bjedi\b/gi, "star-knight"],
  [/\blightsabers?\b/gi, "plasma blade"],
  [/\bmickey mouse\b/gi, "a cheerful cartoon mouse named Pip"],
  [/\bpikachu\b/gi, "a tiny electric creature named Zap"],
  [/\bpok[eé]mon\b/gi, "pocket creatures"],
  [/\bsuper mario\b|\bmario\b/gi, "a mustached plumber named Gino"],
  [/\bjames bond\b|\b007\b/gi, "a suave secret agent named Hale"],
  [/\bshrek\b/gi, "a grumpy swamp ogre"],
  [/\bgodzilla\b/gi, "a colossal sea reptile"],
  [/\bsherlock holmes\b/gi, "a sharp-eyed detective named Ada Quill"],
  // Real people
  [/\btaylor swift\b/gi, "a superstar singer"],
  [/\belon musk\b/gi, "a tech billionaire"],
  [/\btom cruise\b/gi, "an action-movie star"],
  [/\bkeanu reeves\b/gi, "a soft-spoken action hero"],
  [/\bdonald trump\b|\btrump\b/gi, "a brash politician"],
  [/\bbeyonc[eé]\b/gi, "a pop icon"],
  // Brands
  [/\bcoca-?cola\b|\bcoke\b/gi, "a fizzy soda"],
  [/\bmcdonald'?s\b/gi, "a roadside burger joint"],
  [/\bnike\b/gi, "running shoes"],
  [/\bdisney(land)?\b/gi, "a theme park"],
  [/\bstarbucks\b/gi, "a corner coffee shop"],
];

/** `short`: insert only the stand-in's name ("the Nightwarden"), for length-capped fields like titles. */
export function guardIP(text: string, opts: { short?: boolean } = {}): { text: string; replacements: Replacement[] } {
  const replacements: Replacement[] = [];
  let out = text;
  for (const [re, to] of RULES) {
    out = out.replace(re, (from) => {
      if (!replacements.some((r) => r.from.toLowerCase() === from.toLowerCase())) replacements.push({ from, to });
      return opts.short ? shortName(to) : to;
    });
  }
  // Re-capitalize sentence starts that now begin with a lowercase stand-in ("the ...").
  if (replacements.length) out = out.replace(/(^|[.!?]\s+)([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
  return { text: out, replacements };
}

/** Short display name for a stand-in ("the Nightwarden, an original ..." -> "the Nightwarden"). */
export function shortName(to: string) {
  return to.split(",")[0];
}
