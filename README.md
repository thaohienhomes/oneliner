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
3. **Clips → trailer** — the clips are assembled into one video and stored in Vercel Blob.

_TODO: diagram and details._

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in your own keys
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

See `.env.example` for every variable. Leave `COMFY_BASE_URL` blank to use Comfy Cloud.

## Deploy

_TODO: Vercel deploy steps and required environment variables._

## Workflows

The ComfyUI workflows used by the app live in [`workflows/`](./workflows), exported in API format (File → Export Workflow (API)). They are included as required by the contest rules.

## Models & tools used

- LTX-2 (video generation)
- ComfyUI + Comfy SDK / Comfy Cloud
- An OpenAI-compatible LLM (configurable via `LLM_*` env vars)
- Next.js 15, TypeScript, Tailwind CSS
- Vercel Blob

_TODO: exact model versions and licenses._

## License

[MIT](./LICENSE) © 2026 Vip Tom
