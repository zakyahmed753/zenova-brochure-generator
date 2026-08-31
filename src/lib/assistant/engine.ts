"use client";

import type {
  InitProgressReport,
  MLCEngineInterface,
} from "@mlc-ai/web-llm";
import {
  ASSISTANT_JSON_SCHEMA,
  buildAssistantMessages,
  parseAssistantReply,
  type AssistantDraft,
} from "@/lib/assistant/core";

/**
 * Client-only wrapper around WebLLM. The model runs entirely in the visitor's
 * browser via WebGPU — no server, no API key, no per-use cost. Inference runs in
 * a Web Worker so the page never freezes, and generation is streamed so the user
 * sees progress instead of a long blank wait.
 */

export type ModelOption = { id: string; label: string; note: string };

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    label: "Fast",
    note: "~1.0 GB download",
  },
  {
    id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    label: "Fastest",
    note: "~0.5 GB download",
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    label: "Best quality",
    note: "~1.9 GB download",
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

/**
 * Run one extraction, streaming the reply. `onToken` receives the growing text
 * so the UI can show live progress. Requires `loadEngine` to have resolved.
 */
export async function runAssistant(
  userText: string,
  onToken?: (soFar: string) => void,
): Promise<AssistantDraft> {
  if (!engine) throw new Error("The AI model isn't loaded yet.");

  const stream = await engine.chat.completions.create({
    messages: buildAssistantMessages(userText),
    response_format: { type: "json_object", schema: ASSISTANT_JSON_SCHEMA },
    temperature: 0.3,
    max_tokens: 1024,
    stream: true,
  });

  let content = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      content += delta;
      onToken?.(content);
    }
  }
  return parseAssistantReply(content);
}
