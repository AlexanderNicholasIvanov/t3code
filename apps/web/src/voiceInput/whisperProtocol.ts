/** Multilingual Whisper base, 8-bit: about 77 MB, downloaded once and cached by the browser. */
export const WHISPER_MODEL_ID = "onnx-community/whisper-base";

/** Whisper consumes 16 kHz mono PCM. */
export const WHISPER_SAMPLE_RATE = 16_000;

export type WhisperWorkerRequest =
  | { readonly type: "load"; readonly id: number }
  | { readonly type: "transcribe"; readonly id: number; readonly audio: Float32Array };

export type WhisperWorkerResponse =
  | { readonly type: "progress"; readonly loaded: number; readonly total: number }
  | { readonly type: "loaded"; readonly id: number }
  | { readonly type: "transcript"; readonly id: number; readonly text: string }
  | { readonly type: "error"; readonly id: number; readonly message: string };

export type ModelFileProgress = { readonly loaded: number; readonly total: number };

/** Sums per-file download progress; files whose size is not known yet do not count. */
export function aggregateModelDownloadProgress(
  files: ReadonlyMap<string, ModelFileProgress>,
): ModelFileProgress {
  let loaded = 0;
  let total = 0;
  for (const file of files.values()) {
    if (file.total <= 0) continue;
    loaded += Math.min(file.loaded, file.total);
    total += file.total;
  }
  return { loaded, total };
}
