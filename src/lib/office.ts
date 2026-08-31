import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/**
 * Thrown when a document can only be converted by LibreOffice and no
 * `soffice` binary is available on this host. The API turns it into a clear,
 * per-file "skipped" reason rather than a hard failure.
 */
export class LibreOfficeUnavailableError extends Error {
  constructor() {
    super("LibreOffice isn't installed on the server, so this document type can't be converted here");
    this.name = "LibreOfficeUnavailableError";
  }
}

// `undefined` = not looked yet, `null` = looked and not found, string = path.
let cachedPath: string | null | undefined;

async function locateSoffice(): Promise<string | null> {
  if (cachedPath !== undefined) return cachedPath;

  const candidates = [
    process.env.SOFFICE_PATH,
    "soffice",
    "libreoffice",
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    "/usr/bin/soffice",
    "/usr/bin/libreoffice",
    "/opt/libreoffice/program/soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    try {
      await execFileP(candidate, ["--version"], { timeout: 15_000, windowsHide: true });
      cachedPath = candidate;
      return candidate;
    } catch {
      // not this one — keep looking
    }
  }
  cachedPath = null;
  return null;
}

export async function isLibreOfficeAvailable(): Promise<boolean> {
  return (await locateSoffice()) !== null;
}

/**
 * Convert a single non-image, non-PDF document (Word, Excel, PowerPoint, ODF,
 * RTF, CSV, plain text, HTML, …) to PDF bytes via headless LibreOffice.
 *
 * Every call runs in its own temp working directory and user profile so
 * concurrent conversions in the same process don't fight over LibreOffice's
 * single-instance lock.
 */
export async function convertDocumentToPdf(
  input: Buffer,
  originalName: string,
): Promise<Uint8Array> {
  const soffice = await locateSoffice();
  if (!soffice) throw new LibreOfficeUnavailableError();

  const workDir = await mkdtemp(path.join(tmpdir(), "rb-convert-"));
  const parsed = path.parse(originalName);
  const base = (parsed.name || "document").replace(/[^\p{L}\p{N}\-_ ]/gu, "_").slice(0, 80);
  const ext = /^\.[\p{L}\p{N}]{1,12}$/u.test(parsed.ext) ? parsed.ext : ".bin";
  const inPath = path.join(workDir, `${base}${ext}`);

  try {
    await writeFile(inPath, input);
    const profileUrl = pathToFileURL(path.join(workDir, "profile")).href;

    await execFileP(
      soffice,
      [
        "--headless",
        "--norestore",
        "--nolockcheck",
        "--nodefault",
        "--nofirststartwizard",
        `-env:UserInstallation=${profileUrl}`,
        "--convert-to",
        "pdf",
        "--outdir",
        workDir,
        inPath,
      ],
      { timeout: 90_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
    );

    const produced = (await readdir(workDir)).find((f) => f.toLowerCase().endsWith(".pdf"));
    if (!produced) {
      throw new Error(`LibreOffice produced no PDF for "${originalName}"`);
    }
    return await readFile(path.join(workDir, produced));
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
