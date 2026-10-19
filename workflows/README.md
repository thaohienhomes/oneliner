ComfyUI workflow files in API format (File → Export Workflow (API)). Required by contest rules.

- `zimage_t2i_api.json` — Z-Image Turbo text-to-image; renders the first frame of each shot.
- `ltx23_i2v_api.json` — LTX-2.3 image-to-video (with audio); animates the first frame into the shot clip.
- `ltx25_t2v_api.json` — LTX-2.5 text-to-video (no first frame needed). Included as an alternative workflow; the app does not submit it.

Node inputs the app patches are listed in `lib/workflowMap.ts` and in the main README.
