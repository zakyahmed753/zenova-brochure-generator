"use client";

import { useState } from "react";
import AssistantPanel from "@/components/AssistantPanel";
import { draftToBrochureRequest, type AssistantDraft } from "@/lib/assistant/core";
import { defaultOptions, loadSavedBrand } from "@/lib/defaults";

/**
 * Landing-page "one-shot" flow: a description in, a finished PDF out. Brand
 * identity comes from the user's saved brand default (set once in the wizard),
 * or sensible placeholders if they've never saved one.
 */
export default function AssistantOneShot({
  onBack,
  onRefine,
}: {
  onBack: () => void;
  onRefine: (draft: AssistantDraft) => void;
}) {
  const [draft, setDraft] = useState<AssistantDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function generate(d: AssistantDraft) {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const req = draftToBrochureRequest(d, loadSavedBrand(), {
        ...defaultOptions,
        fileName: d.coverTitle || d.listings[0]?.title || "brochure",
      });
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? `Request failed (${res.status})`);
      }
      const blob = await res.blob();
      const match = (res.headers.get("Content-Disposition") ?? "").match(/filename="(.+?)"/);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] ?? "brochure.pdf";
      a.click();
      URL.revokeObjectURL(url);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate the PDF.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 text-sm text-neutral-500 hover:text-neutral-800"
      >
        ← All tools
      </button>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Describe it with AI</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Free and private — the model runs in your browser. It uses the brand you saved in the
          builder (logo, colours, contact details) if you have one.
        </p>
      </header>

      <AssistantPanel
        ctaLabel="Draft & make PDF"
        onDraft={async (d) => {
          setDraft(d);
          await generate(d);
        }}
      />

      {busy && <p className="mt-4 text-sm text-neutral-500">Rendering the PDF…</p>}
      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {draft && !busy && (
        <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
          <p className="text-sm text-neutral-700">
            {done ? "PDF downloaded." : "Draft ready."} {draft.listings.length} propert
            {draft.listings.length === 1 ? "y" : "ies"}
            {draft.listings[0]?.title ? ` — “${draft.listings[0].title}”` : ""}.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => generate(draft)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:border-neutral-400"
            >
              {done ? "Download again" : "Make PDF"}
            </button>
            <button
              type="button"
              onClick={() => onRefine(draft)}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
            >
              Refine in the builder
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
