/// <reference lib="webworker" />
import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from "@huggingface/transformers";
import ortFactoryUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

import {
  aggregateModelDownloadProgress,
  WHISPER_MODEL_ID,
  type ModelFileProgress,
  type WhisperWorkerRequest,
  type WhisperWorkerResponse,
} from "./whisperProtocol";

declare const self: DedicatedWorkerGlobalScope;

env.allowLocalModels = false;
// ONNX Runtime loads from the app's own origin: the desktop CSP allows neither
// CDN scripts nor the blob: URLs transformers.js uses for its WASM cache.
env.useWasmCache = false;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = { mjs: ortFactoryUrl, wasm: ortWasmUrl };
}

const fileProgress = new Map<string, ModelFileProgress>();
let speechRecognizer: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function post(response: WhisperWorkerResponse): void {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Dedicated workers do not accept a target origin.
  self.postMessage(response);
}

function reportProgress(info: ProgressInfo): void {
  if (info.status !== "progress") return;
  fileProgress.set(info.file, { loaded: info.loaded, total: info.total });
  post({ type: "progress", ...aggregateModelDownloadProgress(fileProgress) });
}

function loadSpeechRecognizer(): Promise<AutomaticSpeechRecognitionPipeline> {
  speechRecognizer ??= pipeline("automatic-speech-recognition", WHISPER_MODEL_ID, {
    device: "wasm",
    dtype: "q8",
    progress_callback: reportProgress,
  }).catch((error: unknown) => {
    // A failed download must not poison later attempts.
    speechRecognizer = null;
    throw error;
  });
  return speechRecognizer;
}

self.addEventListener("message", (event: MessageEvent<WhisperWorkerRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      const recognize = await loadSpeechRecognizer();
      if (request.type === "load") {
        post({ type: "loaded", id: request.id });
        return;
      }
      // Recordings run up to five minutes; Whisper reads 30 second windows.
      const output = await recognize(request.audio, { chunk_length_s: 30, stride_length_s: 5 });
      const text = (Array.isArray(output) ? output : [output]).map((part) => part.text).join(" ");
      post({ type: "transcript", id: request.id, text });
    } catch (error) {
      post({
        type: "error",
        id: request.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
});
