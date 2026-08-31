import puppeteer, { type Browser, type Page } from "puppeteer";
import { buildBrochureHtml } from "./brochure-template";
import type { BrochureRequest } from "./types";

/**
 * A single shared browser instance is reused across requests — launching Chromium
 * per request costs ~300ms and a lot of memory. Node keeps this module-level
 * value alive for the life of the server process.
 */
let browserPromise: Promise<Browser> | null = null;

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  // Containers (Render, most PaaS) ship a 64 MB /dev/shm; without this Chromium
  // hangs or crashes on any non-trivial page. This is the usual "PDF route times
  // out in prod but works locally" culprit.
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--font-render-hinting=none",
];

async function launch(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    args: LAUNCH_ARGS,
    timeout: 60_000,
    // Cap every DevTools command so a wedged renderer rejects instead of hanging.
    protocolTimeout: 90_000,
  });
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) browserPromise = launch();
  try {
    const b = await browserPromise;
    if (b.connected) return b;
  } catch {
    // fall through to relaunch
  }
  browserPromise = null;
  return getBrowser();
}

/** Drop the shared browser so the next request starts a fresh one. */
async function resetBrowser(): Promise<void> {
  const p = browserPromise;
  browserPromise = null;
  try {
    const b = await p;
    await b?.close();
  } catch {
    /* already gone */
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
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
async function waitForImages(page: Page): Promise<void> {
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
 * Render `html` to a PDF, guarded end-to-end so a stuck Chromium fails the
 * request (and recycles the browser) instead of hanging forever.
 */
async function renderHtmlToPdf(
  html: string,
  pageSize: "A4" | "Letter",
): Promise<Uint8Array> {
  const browser = await getBrowser();
  let page: Page | null = null;
  try {
    page = await withTimeout(browser.newPage(), 20_000, "newPage");
    await withTimeout(
      page.setContent(html, { waitUntil: "load", timeout: 30_000 }),
      35_000,
      "setContent",
    );
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await waitForImages(page);
    return await withTimeout(
      page.pdf({ format: pageSize, printBackground: true, preferCSSPageSize: true }),
      60_000,
      "page.pdf",
    );
  } catch (err) {
    // A timeout usually means the browser is wedged — start fresh next time.
    await resetBrowser();
    throw err;
  } finally {
    await page?.close().catch(() => {});
  }
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

  return renderHtmlToPdf(html, pageSize);
}

export async function renderBrochurePdf(req: BrochureRequest): Promise<Uint8Array> {
  return renderHtmlToPdf(buildBrochureHtml(req), req.options.pageSize);
}
