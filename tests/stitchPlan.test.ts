import { describe, expect, it } from "vitest";
import {
  buildCardArgs,
  buildStitchArgs,
  FADE_SECONDS,
  parseLogTime,
  parseProbeLog,
  plannedDuration,
  trailerSegments,
  keepsClipAudio,
} from "../lib/stitchPlan";

const clips = [
  { file: "c0.mp4", seconds: 3, hasAudio: true },
  { file: "c1.mp4", seconds: 2, hasAudio: true },
];
const graph = (args: string[]) => args[args.indexOf("-filter_complex") + 1];

describe("stitch plan", () => {
  it("lays out cold open, shots, end card and sums the target", () => {
    const segs = trailerSegments(clips, { endFile: "end.mp4", coldOpenFile: "cold.mp4" });
    expect(segs.map((s) => [s.file, s.target])).toEqual([
      ["cold.mp4", 1],
      ["c0.mp4", 3],
      ["c1.mp4", 2],
      ["end.mp4", 2],
    ]);
    expect(plannedDuration(segs)).toBe(8);
    expect(trailerSegments(clips, { endFile: "end.mp4" })[0].file).toBe("c0.mp4");
  });

  it("holds the last frame and trims every segment; extends non-final ones by the fade", () => {
    const segs = trailerSegments(clips, { endFile: "end.mp4" });
    const g = graph(buildStitchArgs(segs, { width: 768, height: 448, output: "o.mp4" }));
    expect(g).toContain(`tpad=stop_mode=clone:stop_duration=${3 + FADE_SECONDS}`);
    expect(g).toContain(`trim=duration=${3 + FADE_SECONDS}`);
    expect(g).toContain("trim=duration=2,setpts=PTS-STARTPTS[v2]");
    // xfade offsets: 3, then 3+2 = 5 (fade compensation keeps the timeline exact).
    expect(g).toContain("xfade=transition=fade:duration=0.24:offset=3[");
    expect(g).toContain("offset=5[vout]");
    expect(g).toContain("scale=768:448:force_original_aspect_ratio=decrease");
  });

  it("uses hard cuts (concat) when crossfade is off", () => {
    const segs = trailerSegments(clips, { endFile: "end.mp4" });
    const g = graph(buildStitchArgs(segs, { width: 768, height: 448, crossfade: false, output: "o.mp4" }));
    expect(g).toContain("concat=n=3:v=1:a=1[vout][aout]");
    expect(g).not.toContain("xfade");
    expect(g).toContain("tpad=stop_mode=clone:stop_duration=3,");
  });

  it("keeps clip audio only if every clip has it", () => {
    const segs = trailerSegments(clips, { endFile: "end.mp4" });
    expect(keepsClipAudio(segs)).toBe(true);
    const g = graph(buildStitchArgs(segs, { width: 768, height: 448, output: "o.mp4" }));
    expect(g).toContain("[0:a]aresample");
    expect(g).toContain("anullsrc"); // the card is silent

    const mixed = trailerSegments([clips[0], { ...clips[1], hasAudio: false }], { endFile: "end.mp4" });
    expect(keepsClipAudio(mixed)).toBe(false);
    const g2 = graph(buildStitchArgs(mixed, { width: 768, height: 448, output: "o.mp4" }));
    expect(g2).not.toContain(":a]");
    expect(g2.match(/anullsrc/g)).toHaveLength(3);
  });

  it("builds an exact-length card", () => {
    const a = buildCardArgs("t.png", 2, { width: 768, height: 448, output: "t.mp4" });
    expect(a).toEqual(expect.arrayContaining(["-loop", "1", "-frames:v", "50", "t.mp4"]));
  });

  it("parses ffmpeg logs", () => {
    const log = `Input #0, mov,mp4, from 'clip0.mp4':
  Duration: 00:00:01.96, start: 0.000000, bitrate: 1495 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 768x448, 25 fps
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp`;
    expect(parseProbeLog(log)).toEqual({ duration: 1.96, hasAudio: true, hasVideo: true });
    expect(parseProbeLog(log.split("\n").slice(0, 3).join("\n")).hasAudio).toBe(false);
    expect(parseLogTime("frame=  100 fps= 20 q=28.0 size=  256kB time=00:00:04.12 bitrate=")).toBeCloseTo(4.12);
    expect(parseLogTime("time=N/A")).toBeNull();
  });
});
