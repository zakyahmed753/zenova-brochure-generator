import { NextResponse } from "next/server";
import { convertFilesToPdf, ConvertError, type ConvertInput } from "@/lib/convert";
import { toSafeFileName } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILES = 40;
const MAX_ONE_BYTES = 40 * 1024 * 1024; // 40 MB per file
const MAX_TOTAL_BYTES = 120 * 1024 * 1024; // 120 MB per request

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart/form-data upload" }, { status: 400 });
  }

  const uploads = form.getAll("files").filter((f): f is File => f instanceof File);
  if (uploads.length === 0) {
    return NextResponse.json({ error: "Add at least one file" }, { status: 400 });
  }
  if (uploads.length > MAX_FILES) {
    return NextResponse.json({ error: `Too many files — ${MAX_FILES} max` }, { status: 422 });
  }

  const files: ConvertInput[] = [];
  let total = 0;
  for (const upload of uploads) {
    if (upload.size > MAX_ONE_BYTES) {
      return NextResponse.json(
        { error: `"${upload.name || "file"}" is over the 40 MB per-file limit` },
        { status: 422 },
      );
    }
    total += upload.size;
    if (total > MAX_TOTAL_BYTES) {
      return NextResponse.json({ error: "The upload is over the 120 MB total limit" }, { status: 422 });
    }
    files.push({
      name: upload.name || "file",
      type: upload.type || "",
      bytes: new Uint8Array(await upload.arrayBuffer()),
    });
  }

  const pageSize = form.get("pageSize") === "Letter" ? "Letter" : "A4";
  const fileName = toSafeFileName(String(form.get("fileName") || "converted"));

  try {
    const { pdf, skipped } = await convertFilesToPdf(files, pageSize);
    const headers: Record<string, string> = {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "no-store",
    };
    if (skipped.length) {
      headers["X-Convert-Skipped"] = encodeURIComponent(JSON.stringify(skipped));
    }
    return new NextResponse(Buffer.from(pdf), { status: 200, headers });
  } catch (err) {
    if (err instanceof ConvertError) {
      return NextResponse.json({ error: err.message, skipped: err.skipped }, { status: 422 });
    }
    console.error("File conversion failed", err);
    return NextResponse.json({ error: "Conversion failed" }, { status: 500 });
  }
}
