import { PDFDocument } from "pdf-lib";
import { renderImagesPdf } from "./pdf";
import { convertDocumentToPdf, LibreOfficeUnavailableError } from "./office";

/**
 * Standalone "any file / photos → one PDF" pipeline, shared by the /api/convert
 * route. Files are processed in the order given:
 *   - browser-renderable images  → one page each, via headless Chromium
 *   - existing PDFs              → merged in as-is
 *   - everything else            → LibreOffice → PDF, then merged
 * A file that can't be converted is skipped (with a reason) rather than failing
 * the whole batch — unless nothing at all converts.
 */

export type ConvertPageSize = "A4" | "Letter";

export type ConvertInput = { name: string; type: string; bytes: Uint8Array };

export type SkippedFile = { name: string; reason: string };

export type ConvertOutput = { pdf: Uint8Array; skipped: SkippedFile[] };

export class ConvertError extends Error {
  skipped: SkippedFile[];
  constructor(message: string, skipped: SkippedFile[] = []) {
    super(message);
    this.name = "ConvertError";
    this.skipped = skipped;
  }
}

const BROWSER_IMAGE_MIME = /^image\/(jpeg|png|webp|gif|bmp|avif|svg\+xml)$/i;
const BROWSER_IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|svg)$/i;
const PDF_EXT = /\.pdf$/i;

function isBrowserImage(f: ConvertInput): boolean {
  return BROWSER_IMAGE_MIME.test(f.type) || (!f.type && BROWSER_IMAGE_EXT.test(f.name));
}
function isPdf(f: ConvertInput): boolean {
  return f.type === "application/pdf" || (!f.type && PDF_EXT.test(f.name));
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

function imageDataUrl(f: ConvertInput): string {
  const ext = f.name.toLowerCase().split(".").pop() ?? "";
  const mime = BROWSER_IMAGE_MIME.test(f.type)
    ? f.type
    : IMAGE_MIME_BY_EXT[ext] ?? "application/octet-stream";
  return `data:${mime};base64,${Buffer.from(f.bytes).toString("base64")}`;
}

function reasonOf(err: unknown): string {
  if (err instanceof LibreOfficeUnavailableError) return err.message;
  if (err instanceof Error) return err.message;
  return "conversion failed";
}

async function appendPdf(target: PDFDocument, bytes: Uint8Array): Promise<void> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = await target.copyPages(src, src.getPageIndices());
  for (const page of pages) target.addPage(page);
}

export async function convertFilesToPdf(
  files: ConvertInput[],
  pageSize: ConvertPageSize,
): Promise<ConvertOutput> {
  const merged = await PDFDocument.create();
  const skipped: SkippedFile[] = [];

  // Consecutive images share a single Chromium render pass.
  let imageRun: ConvertInput[] = [];
  async function flushImages() {
    if (!imageRun.length) return;
    const run = imageRun;
    imageRun = [];
    try {
      const bytes = await renderImagesPdf(
        run.map((f) => ({ dataUrl: imageDataUrl(f) })),
        pageSize,
      );
      await appendPdf(merged, bytes);
    } catch (err) {
      for (const f of run) skipped.push({ name: f.name, reason: reasonOf(err) });
    }
  }

  for (const file of files) {
    if (isBrowserImage(file)) {
      imageRun.push(file);
      continue;
    }
    await flushImages();

    try {
      if (isPdf(file)) {
        await appendPdf(merged, file.bytes);
      } else {
        const bytes = await convertDocumentToPdf(Buffer.from(file.bytes), file.name);
        await appendPdf(merged, bytes);
      }
    } catch (err) {
      skipped.push({ name: file.name, reason: reasonOf(err) });
    }
  }
  await flushImages();

  if (merged.getPageCount() === 0) {
    throw new ConvertError(
      skipped[0]?.reason ?? "None of the files could be converted to PDF.",
      skipped,
    );
  }

  return { pdf: await merged.save(), skipped };
}
