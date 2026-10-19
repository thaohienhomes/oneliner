# Oneliner

Type your story in one sentence. Get a movie trailer.

#OpenSourceHiggsfield

## What it is

Oneliner turns a single-sentence logline into a short cinematic trailer. You write one line; the app plans the shots, generates the video clips, and stitches them into a trailer you can watch and share.

_TODO: expand._

## Demo video

_TODO: link to demo video._

## Live link

_TODO: link to the deployed app._

## How it works (Comfy SDK + LTX-2)

1. **Logline → shot list** — an LLM expands your sentence into a short sequence of trailer shots.
2. **Shots → clips** — each shot is rendered with **LTX-2** video generation running on ComfyUI, driven through the **Comfy SDK** (Comfy Cloud by default, or your own ComfyUI server).
3. **Clips → trailer** — **in your browser** with ffmpeg.wasm: a canvas title card (title + tagline, letterbox bars) and an optional 1s cold-open title are encoded to MP4, every clip is normalized to the same size/fps/pixel format, held on its last frame to its exact target length (LTX rounds frames down: a 2s shot comes out 1.96s), and joined with 6-frame crossfades. Clip audio is kept only if every clip has it; otherwise the track is silence. Preview + Download MP4.

4. **Publish & share** — "Publish" uploads the MP4, a poster (first frame) and `trailers/{id}.json` (title, tagline, logline, shots with prompts/presets, aspect, videoUrl, createdAt) under a short nanoid. Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set, otherwise a local adapter (`public/trailers/`, served by `/media/trailers/[file]` with Range support). `/t/[id]` has the player, director's notes, Download MP4, Copy link and share-intent buttons for X / Reddit / LinkedIn (prefilled with #OpenSourceHiggsfield; nothing is posted automatically), plus og:video / og:image tags. The home page shows the 6 most recent trailers.

### Cost guard & safety

- **Daily budget** — every shot render counts against a per-IP `DAILY_RENDER_LIMIT` and a site-wide `GLOBAL_DAILY_SHOTS` (Upstash Redis when `UPSTASH_REDIS_REST_URL`/`TOKEN` are set, in-memory otherwise). Over budget, `POST /api/shot` answers 429 "Daily studio budget used — watch the gallery or run it locally" before any Comfy call.
- **Server validation** — `POST /api/shot` rejects (never clamps) shots outside 2–4 whole seconds, a 7th shot, sizes above `I2V_MAX_SIZE` (lib/workflowMap.ts), and prompts over 1200 characters.
- **Content** — PG-13 rules in the shot-list system prompt, a small deterministic filter (lib/contentFilter.ts), and the real-name/brand/franchise guard (lib/ipGuard.ts).
- **`DEMO_MODE=1`** — plays the sample clips in `public/samples/` instead of calling Comfy (no credits, no budget used).
- Friendly toasts for 401 / out of credits / timeouts / budget; API errors never include raw SDK messages or stack traces (details go to the server log).

_TODO: diagram._

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in your own keys
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

See `.env.example` for every variable. Leave `COMFY_BASE_URL` blank to use Comfy Cloud.

### Shot-list LLM

The shot-list writer calls an OpenAI-compatible Chat Completions API in JSON mode, Groq by default:

| Variable | Default |
| --- | --- |
| `LLM_API_KEY` (or `GROQ_API_KEY`) | none: no key = mock |
| `LLM_BASE_URL` | `https://api.groq.com/openai/v1` |
| `LLM_MODEL` | `openai/gpt-oss-120b` |
| `LLM_FALLBACK_MODEL` | `qwen/qwen3.8-27b` (`none` to disable) |
| `LLM_MOCK` | off; `1` forces the deterministic mock |

Each model gets ~20s and one repair attempt if its JSON doesn't validate. If both models fail, the deterministic mock answers so the editor never dead-ends. `/api/shotlist` and `/api/shotlist/regenerate` return `"provider": "llm" | "mock"`, `"model"` (model id or `"mock"`), and `"fallback": true` when the mock stood in for a failing LLM. The IP guard (blocklist + "original characters only" instructions) runs on both paths, before and after the model.

```bash
npm test                                         # unit + editor tests (vitest, no network)
npx tsx scripts/llm-smoke.ts                     # REAL Groq calls (<= 6): 3 loglines + fallback model, prints latency/model
npx tsx scripts/check-shotlist.ts http://localhost:3000   # API smoke test against a running dev server
npx tsx scripts/stitch-test.ts                   # stitch filter graph with native ffmpeg + ffprobe checks (no credits)
npx tsx scripts/stitch-browser.ts http://localhost:3100   # same, through the real UI + ffmpeg.wasm in headless Edge/Chrome
npx tsx scripts/stitch-browser.ts http://localhost:3100 --publish   # + Publish, then curl the share page / MP4 / gallery
npm run build && npx tsx scripts/cost-guard-e2e.ts   # DAILY_RENDER_LIMIT=2 against a fake local Comfy (zero credits)
```

The stitcher's ffmpeg arguments live in `lib/stitchPlan.ts` and are shared by the browser and both scripts. ffmpeg.wasm uses the single-threaded core from unpkg (no COOP/COEP headers needed); its worker is copied unbundled to `public/ffmpeg/` on `predev`/`prebuild`, because bundling it breaks the core's dynamic import.

## Deploy

_TODO: Vercel deploy steps and required environment variables._

## Workflows

The ComfyUI workflows used by the app live in [`workflows/`](./workflows), exported in API format (File → Export Workflow (API)). They are included as required by the contest rules.

## Models & tools used

- LTX-2 (video generation)
- ComfyUI + Comfy SDK / Comfy Cloud
- Shot-list LLM: `openai/gpt-oss-120b` with `qwen/qwen3.8-27b` fallback, on Groq (any OpenAI-compatible API via `LLM_*` env vars)
- Next.js 15, TypeScript, Tailwind CSS
- Vercel Blob

_TODO: exact model versions and licenses._

## License

[MIT](./LICENSE) © 2026 Vip Tom
