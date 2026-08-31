"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InitProgressReport } from "@mlc-ai/web-llm";
import type { AssistantDraft } from "@/lib/assistant/core";
import {
  DEFAULT_MODEL_ID,
  MODEL_OPTIONS,
  engineReady,
  isWebGpuAvailable,
  loadEngine,
  runAssistant,
} from "@/lib/assistant/engine";

/**
 * Free, in-browser AI drafting panel. The language model runs locally via
 * WebGPU (no server, no API key), in a Web Worker so the page stays responsive.
 * The model starts downloading as soon as the box is focused so the wait
 * overlaps with typing.
 */

const EXAMPLE =
  "4-bedroom villa in Palm Hills, New Cairo. 320 m², 4 baths, private garden and pool, sea view from the roof terrace. EGP 12,500,000. Modern finishes, smart-home system, 2 covered parking spots.";

type Phase = "idle" | "loading" | "ready" | "thinking";

export default function AssistantPanel({
  onDraft,
  ctaLabel = "Draft it",
  compact = false,
}: {
  onDraft: (draft: AssistantDraft) => void | Promise<void>;
  ctaLabel?: string;
  compact?: boolean;
}) {
  const supported = isWebGpuAvailable();
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [phase, setPhase] = useState<Phase>(engineReady(DEFAULT_MODEL_ID) ? "ready" : "idle");
  const [progress, setProgress] = useState<{ text: string; pct: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A ticking "Drafting… Ns" so it's obvious the thing is alive (no streaming).
  useEffect(() => {
    if (phase !== "thinking") return;
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const busy = phase === "loading" || phase === "thinking";

  const onProgress = useCallback((r: InitProgressReport) => {
    if (!alive.current) return;
    setProgress({ text: r.text, pct: Math.round((r.progress ?? 0) * 100) });
  }, []);

  // Warm the model on first focus so the download runs while the user types.
  const warm = useCallback(() => {
    if (phase !== "idle") return;
    setPhase("loading");
    setError(null);
    loadEngine(modelId, onProgress)
      .then(() => {
        if (!alive.current) return;
        setProgress(null);
        setPhase((p) => (p === "loading" ? "ready" : p));
      })
      .catch((e) => {
        if (!alive.current) return;
        setProgress(null);
        setPhase((p) => (p === "loading" ? "idle" : p));
        setError(e instanceof Error ? `Couldn't load the model: ${e.message}` : "Couldn't load the model.");
      });
  }, [phase, modelId, onProgress]);

  async function run() {
    if (!text.trim()) {
      setError("Describe the property first.");
      return;
    }
    setError(null);
    setElapsed(0);
    setPhase("thinking");
    try {
      if (!engineReady(modelId)) {
        await loadEngine(modelId, onProgress);
        if (alive.current) setProgress(null);
      }
      const draft = await runAssistant(text);
      if (!alive.current) return;
      setPhase("ready");
      await onDraft(draft);
    } catch (e) {
      if (!alive.current) return;
      setPhase(engineReady(modelId) ? "ready" : "idle");
      setError(e instanceof Error ? e.message : "The assistant failed. Try again.");
    }
  }

  if (!supported) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
        The free AI assistant needs a browser with <strong>WebGPU</strong> (recent Chrome, Edge,
        or Safari on a reasonably modern device). You can still build the brochure by hand.
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-neutral-200 bg-white ${compact ? "p-4" : "p-5"}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm font-medium text-neutral-800">✨ Draft with free local AI</span>
        <select
          value={modelId}
          disabled={busy}
          onChange={(e) => {
            setModelId(e.target.value);
            setPhase(engineReady(e.target.value) ? "ready" : "idle");
          }}
          className="w-full max-w-full rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 disabled:opacity-50 sm:w-auto"
        >
          {MODEL_OPTIONS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} — {m.note}
            </option>
          ))}
        </select>
      </div>

      <p className="mt-1 text-xs text-neutral-500">
        Runs in your browser. The chosen model downloads once (then it&apos;s cached). Weak GPU?
        Keep it on <strong>Fast (default)</strong>.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={warm}
        disabled={phase === "thinking"}
        rows={compact ? 3 : 5}
        placeholder={`e.g. ${EXAMPLE}`}
        className="mt-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 disabled:bg-neutral-50"
      />

      {progress && phase === "loading" && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
            <div
              className="h-full bg-neutral-900 transition-[width]"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
          <p className="mt-1 truncate text-xs text-neutral-500">
            One-time model download — {progress.text}
          </p>
        </div>
      )}

      {phase === "thinking" && (
        <p className="mt-3 text-xs text-neutral-500">Drafting… {elapsed}s (stops at ~70s)</p>
      )}

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={phase === "thinking" || !text.trim()}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {phase === "loading" ? "Preparing model…" : phase === "thinking" ? "Drafting…" : ctaLabel}
        </button>
        {phase === "ready" && <span className="text-xs text-emerald-600">Model ready</span>}
        <button
          type="button"
          onClick={() => setText(EXAMPLE)}
          disabled={phase === "thinking"}
          className="text-xs text-neutral-500 underline hover:text-neutral-800 disabled:opacity-40"
        >
          Use example
        </button>
      </div>
    </div>
  );
}
