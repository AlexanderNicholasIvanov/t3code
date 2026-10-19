import type { VoiceInputState } from "@t3tools/client-runtime/voice-input";
import { MicIcon, SquareIcon } from "lucide-react";

import type { ModelFileProgress } from "~/voiceInput/whisperProtocol";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function voiceInputLabel(
  state: VoiceInputState,
  modelDownload: ModelFileProgress | null,
): { readonly action: string; readonly status: string | null } {
  switch (state.phase) {
    case "preparing":
      return {
        action: "Cancel voice input",
        status:
          modelDownload && modelDownload.total > 0
            ? `Downloading speech model… ${Math.floor((modelDownload.loaded / modelDownload.total) * 100)}%`
            : "Starting voice input…",
      };
    case "recording":
      return { action: "Stop and transcribe", status: "Listening" };
    case "transcribing":
      return { action: "Transcribing", status: "Transcribing…" };
    case "error":
      return { action: "Voice input", status: state.error };
    case "idle":
      return { action: "Voice input", status: null };
  }
}

/** Starts, stops, or cancels composer dictation; mirrors the voice input shortcut. */
export function ComposerVoiceInputButton(props: {
  readonly state: VoiceInputState;
  readonly modelDownload: ModelFileProgress | null;
  readonly shortcutLabel: string | null;
  readonly onToggle: () => void;
}) {
  const { action, status } = voiceInputLabel(props.state, props.modelDownload);
  const recording = props.state.phase === "recording";
  const busy = props.state.phase === "preparing" || props.state.phase === "transcribing";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={recording ? "destructive" : "ghost"}
            size="icon-sm"
            disabled={props.state.phase === "transcribing"}
            aria-pressed={recording}
            aria-label={action}
            onPointerDown={(event) => event.preventDefault()}
            onClick={props.onToggle}
          />
        }
      >
        {busy ? <Spinner /> : recording ? <SquareIcon /> : <MicIcon />}
      </TooltipTrigger>
      <TooltipPopup>
        {status ? <div>{status}</div> : null}
        <div>
          {action}
          {props.shortcutLabel ? ` (${props.shortcutLabel})` : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
