"use client";

/**
 * Title card on a canvas at the trailer resolution: near-black frame,
 * letterbox bars, cinematic serif title + italic tagline. Returns PNG bytes;
 * lib/stitchPlan.buildCardArgs turns the still into an exact-length MP4.
 */

export type CardFonts = { title: string; tagline: string };

export type CardInput = { width: number; height: number; title: string; tagline?: string; fonts: CardFonts };

const TITLE_COLOR = "#f5e6c8";
const TAGLINE_COLOR = "rgba(232, 222, 205, 0.78)";

export async function drawTitleCard(input: CardInput): Promise<Uint8Array> {
  const { width: W, height: H } = input;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not available in this browser.");

  // Make sure the web fonts are ready before measuring/drawing.
  await Promise.all([
    document.fonts.load(`600 48px ${input.fonts.title}`),
    document.fonts.load(`italic 400 24px ${input.fonts.tagline}`),
  ]).catch(() => undefined);

  // Background: black with a faint warm glow in the middle.
  ctx.fillStyle = "#0a0806";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
  glow.addColorStop(0, "rgba(251, 191, 36, 0.10)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Letterbox: 2.39:1 inside a landscape frame, 10% bars on portrait.
  const bar = W > H ? Math.max(0, Math.round((H - W / 2.39) / 2)) : Math.round(H * 0.1);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, bar);
  ctx.fillRect(0, H - bar, W, bar);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const maxW = W * 0.82;
  const short = Math.min(W, H);

  // Title: uppercase, tracked out, shrink to fit.
  const title = input.title.trim().toUpperCase() || "UNTITLED";
  let size = Math.round(short * (W > H ? 0.15 : 0.11));
  const track = (px: number) => `${Math.round(px * 0.12)}px`;
  const setTitleFont = () => {
    ctx.font = `600 ${size}px ${input.fonts.title}`;
    if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = track(size);
  };
  setTitleFont();
  while (ctx.measureText(title).width > maxW && size > 12) {
    size -= 2;
    setTitleFont();
  }
  const tagline = input.tagline?.trim();
  const titleY = tagline ? H / 2 - size * 0.35 : H / 2;
  ctx.shadowColor = "rgba(251, 191, 36, 0.35)";
  ctx.shadowBlur = size * 0.4;
  ctx.fillStyle = TITLE_COLOR;
  ctx.fillText(title, W / 2, titleY);
  ctx.shadowBlur = 0;

  if (tagline) {
    // Thin rule, then the tagline.
    const ruleY = titleY + size * 0.72;
    ctx.fillStyle = "rgba(251, 191, 36, 0.55)";
    ctx.fillRect(W / 2 - W * 0.06, ruleY, W * 0.12, Math.max(1, Math.round(short * 0.003)));
    let tSize = Math.round(short * 0.055);
    const setTagFont = () => {
      ctx.font = `italic 400 ${tSize}px ${input.fonts.tagline}`;
      if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
    };
    setTagFont();
    while (ctx.measureText(tagline).width > maxW && tSize > 10) {
      tSize -= 1;
      setTagFont();
    }
    ctx.fillStyle = TAGLINE_COLOR;
    ctx.fillText(tagline, W / 2, ruleY + tSize * 1.2);
  }

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("Could not render the title card.");
  return new Uint8Array(await blob.arrayBuffer());
}
