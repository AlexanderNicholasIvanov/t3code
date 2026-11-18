import type { VoiceRecorderStatus } from "@t3tools/client-runtime/voice-input";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { MediaVoiceRecorder, requestMicrophonePermission } from "./mediaVoiceRecorder";

class FakeTrack extends EventTarget {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  readonly track = new FakeTrack();
  getTracks() {
    return [this.track];
  }
  getAudioTracks() {
    return [this.track];
  }
}

class FakeMediaRecorder extends EventTarget {
  state: "inactive" | "recording" = "inactive";
  readonly mimeType = "audio/webm";
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    const data = new Blob(["voice"], { type: this.mimeType });
    this.dispatchEvent(Object.assign(new Event("dataavailable"), { data }));
    this.dispatchEvent(new Event("stop"));
  }
}

let streams: FakeStream[] = [];
const getUserMedia = vi.fn(async () => {
  const stream = new FakeStream();
  streams.push(stream);
  return stream;
});

beforeEach(() => {
  streams = [];
  getUserMedia.mockClear();
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function startRecorder(onStatus: (status: VoiceRecorderStatus) => void) {
  const recorder = new MediaVoiceRecorder(onStatus);
  await recorder.open();
  await recorder.prepareToRecordAsync();
  return recorder;
}

describe("MediaVoiceRecorder", () => {
  it("finishes at the duration limit with the recorded audio", async () => {
    vi.useFakeTimers();
    const statuses: VoiceRecorderStatus[] = [];
    const recorder = await startRecorder((status) => statuses.push(status));

    recorder.record({ forDuration: 5 });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ isFinished: true, hasError: false });
    const blob = await (await fetch(statuses[0]!.url!)).text();
    expect(blob).toBe("voice");
  });

  it("reports an interrupted recording when the microphone disconnects", async () => {
    const statuses: VoiceRecorderStatus[] = [];
    const recorder = await startRecorder((status) => statuses.push(status));

    recorder.record({ forDuration: 60 });
    streams[0]!.track.dispatchEvent(new Event("ended"));

    expect(statuses).toEqual([
      { isFinished: false, hasError: true, error: "The microphone was disconnected.", url: null },
    ]);
  });

  it("settles a stop that comes before recording starts", async () => {
    const recorder = await startRecorder(() => {});
    await expect(recorder.stop()).resolves.toBeUndefined();
    expect(recorder.uri).toBeNull();
  });

  it("releases the microphone when closed", async () => {
    const recorder = await startRecorder(() => {});
    recorder.record({ forDuration: 60 });
    await recorder.stop();
    recorder.close();
    expect(streams[0]!.track.stopped).toBe(true);
  });
});

describe("requestMicrophonePermission", () => {
  it("does not keep the microphone open after a grant", async () => {
    await expect(requestMicrophonePermission()).resolves.toEqual({
      granted: true,
      canAskAgain: true,
    });
    expect(streams[0]!.track.stopped).toBe(true);
  });

  it("points to settings once the microphone is blocked", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
      permissions: { query: async () => ({ state: "denied" }) },
    });
    await expect(requestMicrophonePermission()).resolves.toEqual({
      granted: false,
      canAskAgain: false,
    });
  });
});
