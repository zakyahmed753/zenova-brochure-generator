"use client";

/**
 * Downscale an image file in the browser before it goes into the JSON payload.
 * Print brochures place photos at ~90–210mm wide, so ~1600px on the long edge is
 * plenty and keeps the request small.
 */

type ResizeOpts = {
  maxEdge?: number;
  quality?: number;
  /**
   * "jpeg"  — always output JPEG (flattened on white). Use for photos: PNG
   *           re-encodes of photographs are often 5–15 MB and blow the payload.
   * "auto"  — keep PNG when the source is PNG (needed for logos with transparency).
   */
  format?: "jpeg" | "auto";
  /** Re-encode down to at most this many bytes (approx) by lowering quality/size. */
  maxBytes?: number;
};

export async function fileToResizedDataUrl(
  file: File,
  optsOrMaxEdge: ResizeOpts | number = {},
  legacyQuality?: number,
): Promise<string> {
  const opts: ResizeOpts =
    typeof optsOrMaxEdge === "number"
      ? { maxEdge: optsOrMaxEdge, quality: legacyQuality }
      : optsOrMaxEdge;
  const maxEdge = opts.maxEdge ?? 1600;
  const quality = opts.quality ?? 0.82;
  const format = opts.format ?? "auto";
  const maxBytes = opts.maxBytes ?? 3_500_000;

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That image couldn't be decoded — try a standard JPG or PNG");
  });

  const keepPng = format === "auto" && file.type === "image/png";
  const type = keepPng ? "image/png" : "image/jpeg";

  const render = (edge: number, q: number): string => {
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported by this browser");
    if (type === "image/jpeg") {
      // JPEG has no alpha — flatten transparency onto white, not black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL(type, q);
  };

  let edge = maxEdge;
  let q = quality;
  let url = render(edge, q);

  // Shrink until it fits the payload budget (PNG can't lower quality, so scale).
  for (let i = 0; i < 6 && dataUrlBytes(url) > maxBytes; i++) {
    if (type === "image/jpeg" && q > 0.5) q -= 0.12;
    else edge = Math.round(edge * 0.8);
    url = render(edge, q);
  }
  bitmap.close();

  if (dataUrlBytes(url) > maxBytes * 1.5) {
    throw new Error("That image is too large even after compression — try a smaller file");
  }
  return url;
}

/** Approximate decoded byte size of a base64 data URL. */
function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  return i < 0 ? dataUrl.length : Math.floor((dataUrl.length - i - 1) * 0.75);
}

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
