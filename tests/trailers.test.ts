import { describe, expect, it } from "vitest";
import { shareLinks } from "../lib/site";
import { absoluteUrl, isMp4, publishTrailer, TRAILER_ID, type PublishMeta, type TrailerMeta, type TrailerStorage } from "../lib/trailers";

const mp4 = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypisom"), 0, 0, 2, 0]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const meta: PublishMeta = {
  title: "Batman Returns Home",
  tagline: "One night.",
  logline: "Batman opens a noodle shop.",
  aspect: "16:9",
  duration: 13,
  shots: [{ shotType: "wide", lens: "24mm", cameraMove: "static", mood: "quiet", action: "A man waits.", seconds: 2, prompt: "Wide shot." }],
};

function memoryStorage() {
  const files = new Map<string, { bytes: Uint8Array; type: string }>();
  const s: TrailerStorage = {
    kind: "local",
    async put(file, bytes, type) {
      files.set(file, { bytes, type });
      return `/media/trailers/${file}`;
    },
    async getMeta(id) {
      const f = files.get(`${id}.json`);
      return f ? (JSON.parse(new TextDecoder().decode(f.bytes)) as TrailerMeta) : null;
    },
    async listRecent() {
      return [];
    },
  };
  return { s, files };
}

describe("publishTrailer", () => {
  it("stores mp4 + poster + json under a short id, JSON last", async () => {
    const { s, files } = memoryStorage();
    const t = await publishTrailer({ meta, video: mp4, poster: jpeg }, s);
    expect(t.id).toMatch(TRAILER_ID);
    expect([...files.keys()]).toEqual([`${t.id}.mp4`, `${t.id}.jpg`, `${t.id}.json`]);
    expect(files.get(`${t.id}.mp4`)?.type).toBe("video/mp4");
    expect(t.videoUrl).toBe(`/media/trailers/${t.id}.mp4`);
    const stored = await s.getMeta(t.id);
    expect(stored).toMatchObject({ id: t.id, aspect: "16:9", shots: [{ prompt: "Wide shot." }] });
    expect(Date.parse(stored!.createdAt)).not.toBeNaN();
  });

  it("applies the IP guard to published text", async () => {
    const { s } = memoryStorage();
    const t = await publishTrailer({ meta, video: mp4, poster: jpeg }, s);
    expect(t.title).not.toMatch(/batman/i);
    expect(t.logline).not.toMatch(/batman/i);
  });

  it("rejects non-MP4 video and non-JPEG posters", async () => {
    const { s } = memoryStorage();
    await expect(publishTrailer({ meta, video: jpeg, poster: jpeg }, s)).rejects.toThrow(/MP4/);
    await expect(publishTrailer({ meta, video: mp4, poster: mp4 }, s)).rejects.toThrow(/JPEG/);
    expect(isMp4(mp4)).toBe(true);
  });
});

describe("share links", () => {
  it("only builds intent URLs carrying the contest hashtag", () => {
    const l = shareLinks("https://x.test/t/abc", "The Mars Job");
    expect(l.x).toMatch(/^https:\/\/twitter\.com\/intent\/tweet\?/);
    expect(decodeURIComponent(l.x)).toContain("#OpenSourceHiggsfield");
    expect(decodeURIComponent(l.reddit)).toContain("#OpenSourceHiggsfield");
    expect(l.linkedin).toContain(encodeURIComponent("https://x.test/t/abc"));
    expect(absoluteUrl("/media/trailers/a.mp4", "http://localhost:3100")).toBe("http://localhost:3100/media/trailers/a.mp4");
  });
});
