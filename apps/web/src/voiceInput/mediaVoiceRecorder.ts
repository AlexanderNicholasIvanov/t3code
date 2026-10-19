import type { VoiceRecorder, VoiceRecorderStatus } from "@t3tools/client-runtime/voice-input";

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
};

export function isMediaVoiceRecordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof OfflineAudioContext !== "undefined"
  );
}

/** Asks for the microphone without holding it: recording opens its own stream later. */
export async function requestMicrophonePermission(): Promise<{
  readonly granted: boolean;
  readonly canAskAgain: boolean;
}> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
    for (const track of stream.getTracks()) track.stop();
    return { granted: true, canAskAgain: true };
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "NotAllowedError") throw error;
    const state = await navigator.permissions?.query({ name: "microphone" as PermissionName }).then(
      (status) => status.state,
      () => null,
    );
    return { granted: false, canAskAgain: state !== "denied" };
  }
}

/**
 * Records the microphone with MediaRecorder into a blob: URL for the
 * transcriber. `open` and `close` bracket the stream so the browser's
 * recording indicator only shows while a recording is configured.
 */
export class MediaVoiceRecorder implements VoiceRecorder {
  uri: string | null = null;
  private readonly onStatus: (status: VoiceRecorderStatus) => void;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private stopped: Promise<void> = Promise.resolve();
  private started = false;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(onStatus: (status: VoiceRecorderStatus) => void) {
    this.onStatus = onStatus;
  }

  async open(): Promise<void> {
    this.close();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
  }

  close(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }

  async prepareToRecordAsync(): Promise<void> {
    const stream = this.stream;
    if (!stream) throw new Error("The microphone is not open.");
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    this.recorder = recorder;
    this.started = false;
    this.uri = null;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener("error", () => this.fail("Voice recording failed."));
    // A track ends when the device is unplugged or the system revokes access.
    for (const track of stream.getAudioTracks()) {
      track.addEventListener("ended", () => this.fail("The microphone was disconnected."), {
        once: true,
      });
    }
    this.stopped = new Promise((resolve) => {
      recorder.addEventListener(
        "stop",
        () => {
          this.uri = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
          resolve();
        },
        { once: true },
      );
    });
  }

  record(options: { readonly forDuration: number }): void {
    if (!this.recorder) return;
    this.recorder.start();
    this.started = true;
    this.limitTimer = setTimeout(() => {
      void this.stop().then(() =>
        this.onStatus({ isFinished: true, hasError: false, error: null, url: this.uri }),
      );
    }, options.forDuration * 1000);
  }

  async stop(): Promise<void> {
    if (this.limitTimer !== null) clearTimeout(this.limitTimer);
    this.limitTimer = null;
    if (!this.started) return;
    if (this.recorder?.state !== "inactive") this.recorder?.stop();
    await this.stopped;
  }

  // The controller ignores a status that arrives after the recording settled.
  private fail(error: string): void {
    if (!this.started) return;
    this.onStatus({ isFinished: false, hasError: true, error, url: null });
  }
}
