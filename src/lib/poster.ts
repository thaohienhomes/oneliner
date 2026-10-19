"use client";

/** Grab the first frame of a video URL as a JPEG (the share-page poster / og:image). */
export async function grabPoster(videoUrl: string, quality = 0.85): Promise<Blob> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = videoUrl;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Could not read the trailer to make a poster."));
    });
    // Seek a hair past 0 so browsers decode a real frame (0 can stay blank).
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      video.currentTime = 0.04;
    });
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available in this browser.");
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob) throw new Error("Could not encode the poster.");
    return blob;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
