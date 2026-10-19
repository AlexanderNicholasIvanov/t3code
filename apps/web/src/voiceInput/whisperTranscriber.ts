import {
  throwIfVoiceTranscriptionAborted,
  VoiceTranscriptionError,
  type VoiceTranscriber,
  type VoiceTranscriptionErrorCode,
} from "@t3tools/client-runtime/voice-input";

import {
  WHISPER_SAMPLE_RATE,
  type ModelFileProgress,
  type WhisperWorkerRequest,
  type WhisperWorkerResponse,
} from "./whisperProtocol";

type PendingRequest = {
  readonly resolve: (response: WhisperWorkerResponse) => void;
  readonly reject: (error: unknown) => void;
  readonly code: VoiceTranscriptionErrorCode;
};

let worker: Worker | null = null;
let nextRequestId = 0;
const pendingRequests = new Map<number, PendingRequest>();

// Download progress for the first-use model fetch; null once the model is ready.
let modelDownloadProgress: ModelFileProgress | null = null;
const progressListeners = new Set<() => void>();

function setModelDownloadProgress(progress: ModelFileProgress | null): void {
  modelDownloadProgress = progress;
  for (const listener of progressListeners) listener();
}

export function subscribeWhisperModelDownload(listener: () => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

export function readWhisperModelDownload(): ModelFileProgress | null {
  return modelDownloadProgress;
}

/** Terminating is the only way to stop work inside the worker; the next request starts a fresh one. */
function stopWorker(error: unknown): void {
  worker?.terminate();
  worker = null;
  setModelDownloadProgress(null);
  const pending = [...pendingRequests.values()];
  pendingRequests.clear();
  for (const request of pending) request.reject(error);
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  created.addEventListener("message", (event: MessageEvent<WhisperWorkerResponse>) => {
    const response = event.data;
    if (response.type === "progress") {
      setModelDownloadProgress({ loaded: response.loaded, total: response.total });
      return;
    }
    const pending = pendingRequests.get(response.id);
    if (!pending) return;
    pendingRequests.delete(response.id);
    if (response.type === "error") {
      pending.reject(new VoiceTranscriptionError(pending.code, response.message));
      return;
    }
    pending.resolve(response);
  });
  created.addEventListener("error", (event) => {
    stopWorker(
      new VoiceTranscriptionError("unavailable", event.message || "Speech model crashed."),
    );
  });
  worker = created;
  return created;
}

function sendRequest(
  request: WhisperWorkerRequest,
  code: VoiceTranscriptionErrorCode,
  signal: AbortSignal,
  transfer: Transferable[] = [],
): Promise<WhisperWorkerResponse> {
  throwIfVoiceTranscriptionAborted(signal);
  const target = ensureWorker();
  return new Promise((resolve, reject) => {
    const onAbort = () =>
      stopWorker(new VoiceTranscriptionError("cancelled", "Voice transcription was cancelled."));
    signal.addEventListener("abort", onAbort, { once: true });
    pendingRequests.set(request.id, {
      code,
      resolve: (response) => {
        signal.removeEventListener("abort", onAbort);
        resolve(response);
      },
      reject: (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    });
    target.postMessage(request, transfer);
  });
}

/** Decodes a recording and resamples it to the mono 16 kHz PCM Whisper reads. */
async function decodeRecording(uri: string): Promise<Float32Array> {
  const bytes = await (await fetch(uri)).arrayBuffer();
  const audio = await new OfflineAudioContext(1, 1, WHISPER_SAMPLE_RATE).decodeAudioData(bytes);
  const mono = new Float32Array(audio.length);
  for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
    const samples = audio.getChannelData(channel);
    for (let index = 0; index < samples.length; index += 1) {
      mono[index]! += samples[index]! / audio.numberOfChannels;
    }
  }
  return mono;
}

/** Transcribes on-device with Whisper in a worker; the model downloads on first use. */
export const whisperVoiceTranscriber: VoiceTranscriber = {
  prepare: async ({ signal }) => {
    try {
      await sendRequest({ type: "load", id: nextRequestId++ }, "preparation-failed", signal);
    } finally {
      setModelDownloadProgress(null);
    }
    return {
      // Whisper detects the spoken language; the locale only tunes spacing around the insert.
      locale: navigator.language || "en",
      transcribe: async (uri, options) => {
        const audio = await decodeRecording(uri);
        throwIfVoiceTranscriptionAborted(options.signal);
        const response = await sendRequest(
          { type: "transcribe", id: nextRequestId++, audio },
          "transcription-failed",
          options.signal,
          [audio.buffer],
        );
        return response.type === "transcript" ? response.text : "";
      },
    };
  },
};
