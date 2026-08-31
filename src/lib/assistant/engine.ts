"use client";

import type { InitProgressReport, MLCEngineInterface } from "@mlc-ai/web-llm";
import {
  buildAssistantMessages,
  parseAssistantReply,
  type AssistantDraft,
} from "@/lib/assistant/core";

/**
 * Client-only wrapper around WebLLM. The model runs entirely in the visitor's
 * browser via WebGPU — no server, no API key, no per-use cost. Inference runs in
 * a Web Worker so the page never freezes.
 */

export type ModelOption = { id: string; label: string; note: string };

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    label: "Fast (default)",
    note: "~0.5 GB · best on most laptops",
  },
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    label: "Better",
    note: "~1.0 GB · needs a decent GPU",
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    label: "Best",
    note: "~1.9 GB · slow without a strong GPU",
  },
];

export const DEFAULT_MODEL_ID = MODEL_OPTIONS[0].id;

export function isWebGpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

let engine: MLCEngineInterface | null = null;
let loadedModelId: string | null = null;
let loadingPromise: Promise<MLCEngineInterface> | null = null;
let progressCb: ((r: InitProgressReport) => void) | undefined;

/**
 * Load (or switch) the model in a Web Worker. `onProgress` fires with
 * download/compile status. Concurrent calls share one load; asking for a
 * different model reloads.
 */
export async function loadEngine(
  modelId: string,
  onProgress?: (report: InitProgressReport) => void,
): Promise<MLCEngineInterface> {
  progressCb = onProgress;
  if (engine && loadedModelId === modelId) return engine;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const webllm = await import("@mlc-ai/web-llm");
    const forward = (r: InitProgressReport) => progressCb?.(r);

    if (!engine) {
      const worker = new Worker(new URL("./webllm.worker.ts", import.meta.url), {
        type: "module",
      });
      engine = await webllm.CreateWebWorkerMLCEngine(worker, modelId, {
        initProgressCallback: forward,
      });
    } else {
      engine.setInitProgressCallback(forward);
      await engine.reload(modelId);
    }
    loadedModelId = modelId;
    return engine;
  })();

  try {
    return await loadingPromise;
  } catch (err) {
    engine = null;
    loadedModelId = null;
    throw err;
  } finally {
    loadingPromise = null;
  }
}

export function engineReady(modelId: string): boolean {
  return engine !== null && loadedModelId === modelId;
}

/** Hard ceiling — if a single generation isn't done by here, we give up. */
const GENERATION_TIMEOUT_MS = 70_000;

function asMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
    try {
      return JSON.stringify(e).slice(0, 300);
    } catch {
      /* fall through */
    }
  }
  return String(e);
}

async function generateOnce(eng: MLCEngineInterface, userText: string): Promise<string> {
  const generate = eng.chat.completions.create({
    messages: buildAssistantMessages(userText),
    // Plain text — NOT grammar/JSON-constrained decoding. XGrammar adds latency
    // and can throw on some GPUs; the prompt asks for JSON and the parser repairs
    // sloppy output.
    response_format: { type: "text" },
    temperature: 0.2,
    max_tokens: 512,
    stream: false,
  });

  let timer: ReturnType<typeof setTimeout>;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        eng.interruptGenerate();
      } catch {
        /* nothing to interrupt */
      }
      reject(new Error("timeout"));
    }, GENERATION_TIMEOUT_MS);
  });

  try {
    const res = await Promise.race([generate, guard]);
    return res.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Run one extraction. Non-streaming, hard timeout, one retry. Any failure
 * REJECTS with a readable message instead of leaving the UI stuck "drafting".
 */
export async function runAssistant(userText: string): Promise<AssistantDraft> {
  const eng = engine;
  if (!eng) throw new Error("The AI model isn't loaded yet.");

  let content = "";
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      content = await generateOnce(eng, userText);
      if (content.trim()) break;
      lastErr = new Error("empty reply");
    } catch (e) {
      lastErr = e;
      if (asMessage(e) === "timeout" && attempt === 2) {
        throw new Error(
          "The AI is too slow on this device — use the “Fast (default)” model, or fill the wizard by hand.",
        );
      }
    }
  }

  if (!content.trim()) {
    throw new Error(
      `The AI couldn't produce a draft (${asMessage(lastErr)}). Try again, or fill the wizard by hand.`,
    );
  }
  return parseAssistantReply(content);
}
