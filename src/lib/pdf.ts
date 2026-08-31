import puppeteer, { type Browser } from "puppeteer";
import { buildBrochureHtml } from "./brochure-template";
import type { BrochureRequest } from "./types";

/**
 * A single shared browser instance is reused across requests — launching Chromium
 * per request costs ~300ms and a lot of memory. Node keeps this module-level
 * value alive for the life of the server process.
 */
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"],
    });
  }
  try {
    const b = await browserPromise;
    if (b.connected) return b;
  } catch {
    // fall through to relaunch
  }
  browserPromise = null;
  return getBrowser();
}

const SHEET = {
  A4: { w: "210mm", h: "297mm" },
  Letter: { w: "215.9mm", h: "279.4mm" },
};

/**
 * `waitUntil: "load"` covers `<img>` fetching, but a large JPEG can still be
 * mid-decode when `page.pdf()` fires — which prints the photo as a blank box.
 * Force every image to finish decoding first.
 */
async function waitForImages(page: import("puppeteer").Page): Promise<void> {
  await page
    .evaluate(async () => {
      await Promise.all(
        Array.from(document.images).map(async (img) => {
          try {
            if (!img.complete) {
              await new Promise((res) => {
                img.addEventListener("load", res, { once: true });
                img.addEventListener("error", res, { once: true });
              });
            }
            if (img.decode) await img.decode().catch(() => {});
          } catch {
            /* ignore a single bad image */
          }
        }),
      );
    })
    .catch(() => {});
}

/**
 * One image per page, centred and scaled to fit — used by the standalone
 * "files → PDF" converter for anything the browser can render as an `<img>`
 * (JPEG, PNG, WebP, GIF, BMP, AVIF, SVG). Reuses the shared Chromium instance.
 */
export async function renderImagesPdf(
  images: { dataUrl: string }[],
  pageSize: "A4" | "Letter",
): Promise<Uint8Array> {
  const sheet = SHEET[pageSize];
  const body = images
    .map((img) => `<section class="page"><img src="${img.dataUrl}" alt="" /></section>`)
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8" /><style>
    * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { size: ${pageSize}; margin: 0; }
    .page { width: ${sheet.w}; height: ${sheet.h}; overflow: hidden; page-break-after: always; display: flex; align-items: center; justify-content: center; padding: 10mm; background: #fff; }
    .page:last-child { page-break-after: auto; }
    img { max-width: 100%; max-height: 100%; object-fit: contain; }
  </style></head><body>${body}</body></html>`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await waitForImages(page);
    return await page.pdf({
      format: pageSize,
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await page.close();
  }
}

export async function renderBrochurePdf(req: BrochureRequest): Promise<Uint8Array> {
  const html = buildBrochureHtml(req);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await waitForImages(page);
    return await page.pdf({
      format: req.options.pageSize,
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await page.close();
  }
}
