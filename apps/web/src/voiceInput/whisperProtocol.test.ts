import { describe, expect, it } from "vite-plus/test";

import { aggregateModelDownloadProgress } from "./whisperProtocol";

describe("aggregateModelDownloadProgress", () => {
  it("sums files and ignores ones whose size is unknown", () => {
    expect(
      aggregateModelDownloadProgress(
        new Map([
          ["onnx/encoder_model_quantized.onnx", { loaded: 10, total: 20 }],
          ["onnx/decoder_model_merged_quantized.onnx", { loaded: 30, total: 60 }],
          ["tokenizer.json", { loaded: 5, total: 0 }],
        ]),
      ),
    ).toEqual({ loaded: 40, total: 80 });
  });

  it("never reports more than the total for a file", () => {
    expect(
      aggregateModelDownloadProgress(new Map([["config.json", { loaded: 12, total: 10 }]])),
    ).toEqual({ loaded: 10, total: 10 });
  });
});
