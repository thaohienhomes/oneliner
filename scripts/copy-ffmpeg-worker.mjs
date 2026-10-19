// Copies the ffmpeg.wasm module worker (unbundled) to public/ffmpeg/.
// Bundlers rewrite the worker's `import(coreURL)` into a static-module lookup
// ("Cannot find module as expression is too dynamic"), so the browser loads
// this copy via FFmpeg.load({ classWorkerURL: "/ffmpeg/worker.js" }) instead.
// Runs on predev/prebuild; the output folder is gitignored.
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const src = path.join(process.cwd(), "node_modules", "@ffmpeg", "ffmpeg", "dist", "esm");
const dst = path.join(process.cwd(), "public", "ffmpeg");
mkdirSync(dst, { recursive: true });
for (const f of ["worker.js", "const.js", "errors.js"]) copyFileSync(path.join(src, f), path.join(dst, f));
