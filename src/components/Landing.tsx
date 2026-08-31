"use client";

import { useState } from "react";
import Wizard from "@/components/Wizard";
import Converter from "@/components/Converter";
import AssistantOneShot from "@/components/AssistantOneShot";
import type { AssistantDraft } from "@/lib/assistant/core";

type Mode = "choose" | "brochure" | "convert" | "assist";

export default function Landing() {
  const [mode, setMode] = useState<Mode>("choose");
  const [draft, setDraft] = useState<AssistantDraft | null>(null);

  function backBar(label = "← All tools") {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 pt-6">
        <button
          type="button"
          onClick={() => setMode("choose")}
          className="text-sm text-neutral-500 hover:text-neutral-800"
        >
          {label}
        </button>
      </div>
    );
  }

  if (mode === "brochure") {
    return (
      <div>
        {backBar()}
        <Wizard initialDraft={draft} />
      </div>
    );
  }

  if (mode === "convert") {
    return <Converter onBack={() => setMode("choose")} />;
  }

  if (mode === "assist") {
    return (
      <AssistantOneShot
        onBack={() => setMode("choose")}
        onRefine={(d) => {
          setDraft(d);
          setMode("brochure");
        }}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16">
      <header className="mb-10 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Zenova Brochure Generator</h1>
        <p className="mt-1 text-sm text-neutral-500">What would you like to do?</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card
          title="Describe it with AI"
          badge="Free"
          body="Type a property description and a local AI model drafts the brochure — right in your browser, no account, no cost."
          onClick={() => setMode("assist")}
        />
        <Card
          title="Build a brochure"
          body="One brand, any number of properties — a print-ready portfolio PDF, guided step by step."
          onClick={() => setMode("brochure")}
        />
        <Card
          title="Convert files to PDF"
          body="Merge photos, PDFs and Office documents into a single PDF — no brochure needed."
          onClick={() => setMode("convert")}
        />
      </div>
    </div>
  );
}

function Card({
  title,
  body,
  badge,
  onClick,
}: {
  title: string;
  body: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col rounded-xl border border-neutral-200 bg-white p-5 text-left transition hover:border-neutral-900"
    >
      <span className="flex items-center gap-2">
        <span className="text-base font-medium text-neutral-900">{title}</span>
        {badge && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
            {badge}
          </span>
        )}
      </span>
      <span className="mt-2 text-sm text-neutral-500">{body}</span>
    </button>
  );
}
