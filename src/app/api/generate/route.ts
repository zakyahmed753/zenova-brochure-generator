import { NextResponse } from "next/server";
import { brochureRequestSchema, toSafeFileName } from "@/lib/types";
import { renderBrochurePdf } from "@/lib/pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = brochureRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const fileName = toSafeFileName(parsed.data.options.fileName);

  try {
    const pdf = await renderBrochurePdf(parsed.data);
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(pdf.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("PDF generation failed:", detail, err instanceof Error ? err.stack : "");
    return NextResponse.json({ error: "PDF generation failed", detail }, { status: 500 });
  }
}
