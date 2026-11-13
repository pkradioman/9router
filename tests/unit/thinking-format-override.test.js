import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// A custom OpenAI-compatible node that proxies a strict upstream (e.g. Mistral):
// the model name matches the DeepSeek capability patterns, but the host rejects
// the Chat-shaped `thinking` field.
const strictProvider = "openai-compatible-chat-mistral-test";
const model = "deepseek-v4-1-flash-1017";

describe("provider-level thinkingFormat override", () => {
  it("keeps reasoning_effort when the connection declares openai", () => {
    const body = { reasoning_effort: "high", max_tokens: 1024 };
    applyThinking(FORMATS.OPENAI, model, body, strictProvider, undefined, "openai");
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning_effort).toBe("high");
  });

  it("still emits the deepseek shape without an override", () => {
    const body = { reasoning_effort: "high", max_tokens: 1024 };
    applyThinking(FORMATS.OPENAI, model, body, strictProvider);
    expect(body.thinking).toEqual({ type: "enabled" });
  });

  it("ignores the override when the model cannot reason", () => {
    const body = { reasoning_effort: "high" };
    applyThinking(FORMATS.OPENAI, "codestral-latest", body, strictProvider, undefined, "openai");
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });
});
