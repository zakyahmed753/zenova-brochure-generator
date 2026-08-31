import { NextResponse } from "next/server";

// Lightweight liveness probe for Railway / Render / Docker HEALTHCHECK.
// Deliberately does NOT touch Chromium or LibreOffice — it just confirms the
// Node server is up and routing.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, service: "zenova-brochure-generator", ts: Date.now() });
}
