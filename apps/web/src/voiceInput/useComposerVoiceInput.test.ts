import { replaceTextRange } from "@t3tools/shared/composerTrigger";
import { describe, expect, it } from "vite-plus/test";

import { diffTextRange } from "./useComposerVoiceInput";

function applyDiff(previous: string, next: string): string {
  const edit = diffTextRange(previous, next);
  return replaceTextRange(previous, edit.start, edit.end, edit.replacement).text;
}

describe("diffTextRange", () => {
  it("finds a transcript inserted at the caret", () => {
    expect(diffTextRange("fix the bug", "fix the login bug")).toEqual({
      start: 8,
      end: 8,
      replacement: "login ",
    });
  });

  it("replays inserts at either end and into an empty draft", () => {
    for (const [previous, next] of [
      ["", "hello world"],
      ["world", "hello world"],
      ["hello", "hello world"],
      ["aa", "aaa"],
    ] as const) {
      expect(applyDiff(previous, next)).toBe(next);
    }
  });

  it("returns an empty edit when nothing changed", () => {
    expect(diffTextRange("same", "same")).toEqual({ start: 4, end: 4, replacement: "" });
  });
});
