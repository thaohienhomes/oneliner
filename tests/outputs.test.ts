// @vitest-environment node
import { describe, expect, it } from "vitest";
import { pickImageOutput, pickVideoOutput } from "../lib/outputs";
import { I2V } from "../lib/workflowMap";

// Exact shape Comfy Cloud returned for I2V job d9d9e61c-... (mp4 labelled type "image").
const comfyMp4 = { nodeId: "75", name: "oneliner/shot_00001_.mp4", type: "image", contentType: "video/mp4", sizeBytes: 357305 };
const png = { nodeId: "9", name: "oneliner/frame_00001_.png", type: "image", contentType: "image/png", sizeBytes: 400000 };

describe("pickVideoOutput", () => {
  it("picks an mp4 that Comfy labels type=image", () => {
    expect(pickVideoOutput([comfyMp4], I2V.saveVideo.id)).toBe(comfyMp4);
    expect(pickVideoOutput([comfyMp4])).toBe(comfyMp4);
  });

  it("chooses the mp4 over a png sitting next to it, in either order", () => {
    expect(pickVideoOutput([png, comfyMp4], I2V.saveVideo.id)).toBe(comfyMp4);
    expect(pickVideoOutput([png, comfyMp4])).toBe(comfyMp4);
    expect(pickVideoOutput([comfyMp4, png])).toBe(comfyMp4);
  });

  it("prefers the SaveVideo node, then falls back to other nodes", () => {
    const other = { ...comfyMp4, nodeId: "99", name: "preview.mp4" };
    expect(pickVideoOutput([other, comfyMp4], "75")).toBe(comfyMp4);
    expect(pickVideoOutput([other], "75")).toBe(other);
  });

  it("falls back to file extension, then type=video", () => {
    const byExt = { nodeId: "75", name: "clip.webm", type: "image", contentType: "application/octet-stream" };
    expect(pickVideoOutput([png, byExt])).toBe(byExt);
    const byType = { nodeId: "75", name: "clip", type: "video", contentType: "" };
    expect(pickVideoOutput([png, byType])).toBe(byType);
  });

  it("returns undefined when only stills exist", () => {
    expect(pickVideoOutput([png], "75")).toBeUndefined();
  });
});

describe("pickImageOutput", () => {
  it("ignores video content types labelled type=image", () => {
    expect(pickImageOutput([comfyMp4, png])).toBe(png);
    expect(pickImageOutput([comfyMp4])).toBeUndefined();
  });
});
