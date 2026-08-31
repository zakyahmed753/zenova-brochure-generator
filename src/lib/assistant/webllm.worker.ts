/// <reference lib="webworker" />
import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

// Runs the model off the main thread so the page stays responsive while it
// downloads, compiles and generates. Created from engine.ts via `new Worker()`.
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (event: MessageEvent) => {
  handler.onmessage(event);
};
