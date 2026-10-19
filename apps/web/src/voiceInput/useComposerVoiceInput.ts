import {
  VoiceInputController,
  type VoiceDraftSnapshot,
  type VoiceInputState,
} from "@t3tools/client-runtime/voice-input";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  isMediaVoiceRecordingSupported,
  MediaVoiceRecorder,
  requestMicrophonePermission,
} from "./mediaVoiceRecorder";
import {
  readWhisperModelDownload,
  subscribeWhisperModelDownload,
  whisperVoiceTranscriber,
} from "./whisperTranscriber";

const IDLE_STATE: VoiceInputState = { phase: "idle", error: null, errorAction: null };

/** The single replaced range that turns `previous` into `next`. */
export function diffTextRange(
  previous: string,
  next: string,
): { readonly start: number; readonly end: number; readonly replacement: string } {
  let start = 0;
  const maxPrefix = Math.min(previous.length, next.length);
  while (start < maxPrefix && previous[start] === next[start]) start += 1;
  let suffix = 0;
  const maxSuffix = Math.min(previous.length, next.length) - start;
  while (
    suffix < maxSuffix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    start,
    end: previous.length - suffix,
    replacement: next.slice(start, next.length - suffix),
  };
}

export type ComposerVoiceInputOptions = {
  /** Identifies the draft; voice input cancels when it changes. */
  readonly ownerKey: string;
  readonly readDraft: () => VoiceDraftSnapshot | null;
  readonly commitDraft: (
    text: string,
    selection: { readonly start: number; readonly end: number },
  ) => void;
};

/** Dictation for the web composer: records the microphone and transcribes on-device. */
export function useComposerVoiceInput(options: ComposerVoiceInputOptions) {
  const [state, setState] = useState<VoiceInputState>(IDLE_STATE);
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });
  const [supported] = useState(isMediaVoiceRecordingSupported);
  // oxlint-disable-next-line react/refs -- The controller reads the latest options from its callbacks, not during render.
  const [controller] = useState(() => {
    const recorder = new MediaVoiceRecorder((status) => {
      void voiceController.handleRecorderStatus(status);
    });
    const voiceController = new VoiceInputController({
      recorder,
      getTranscriber: () => whisperVoiceTranscriber,
      requestPermission: requestMicrophonePermission,
      configureRecording: () => recorder.open(),
      releaseRecording: async () => recorder.close(),
      deleteRecording: (uri) => URL.revokeObjectURL(uri),
      readDraft: () => optionsRef.current.readDraft(),
      commitDraft: (text, selection) => optionsRef.current.commitDraft(text, selection),
      onStateChange: setState,
    });
    return voiceController;
  });
  const modelDownload = useSyncExternalStore(
    subscribeWhisperModelDownload,
    readWhisperModelDownload,
  );

  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    controller.ownerChanged();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A new draft cancels dictation for the old one.
  }, [controller, options.ownerKey]);

  const toggle = useCallback(() => {
    switch (controller.currentState.phase) {
      case "idle":
      case "error":
        void controller.start();
        return;
      case "recording":
        void controller.stop();
        return;
      case "preparing":
        controller.cancel();
        return;
      case "transcribing":
        return;
    }
  }, [controller]);
  const cancel = useCallback(() => controller.cancel(), [controller]);

  return { supported, state, modelDownload, toggle, cancel };
}
