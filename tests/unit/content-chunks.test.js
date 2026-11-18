import { describe, it, expect } from "vitest";

import {
  flattenContentChunks,
  normalizeOpenAIChatChunk,
  normalizeOpenAIChatResponse,
} from "../../open-sse/utils/contentChunks.js";
import { parseSSEToOpenAIResponse } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";

const thinkingChunk = {
  type: "thinking",
  thinking: [{ type: "text", text: "We need answer in one word." }],
  closed: true,
};

describe("content chunk normalization", () => {
  it("flattens Mistral thinking + text chunks", () => {
    expect(flattenContentChunks([thinkingChunk, { type: "text", text: "Four" }])).toEqual({
      text: "Four",
      reasoning: "We need answer in one word.",
    });
  });

  it("returns null for string content so callers keep their fast path", () => {
    expect(flattenContentChunks("hello")).toBeNull();
    expect(flattenContentChunks(null)).toBeNull();
  });

  it("turns a streamed content array into content + reasoning_content and drops response_error", () => {
    const chunk = {
      id: "x",
      object: "chat.completion.chunk",
      choices: [
        {
          index: 0,
          delta: { content: [thinkingChunk, { type: "text", text: "Four" }] },
          finish_reason: "stop",
          response_error: { content_validation: ["valid_think_chunk"] },
        },
      ],
    };

    expect(normalizeOpenAIChatChunk(chunk)).toBe(true);
    expect(chunk.choices[0].delta.content).toBe("Four");
    expect(chunk.choices[0].delta.reasoning_content).toBe("We need answer in one word.");
    expect(chunk.choices[0].response_error).toBeUndefined();
  });

  it("leaves a plain OpenAI chunk untouched", () => {
    const chunk = { choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }] };
    expect(normalizeOpenAIChatChunk(chunk)).toBe(false);
    expect(chunk.choices[0].delta).toEqual({ content: "ok" });
  });

  it("turns a non-streaming content array into a string message", () => {
    const body = {
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: [thinkingChunk, { type: "text", text: "Four" }] },
          finish_reason: "stop",
          response_error: { content_validation: ["valid_think_chunk"] },
        },
      ],
    };

    expect(normalizeOpenAIChatResponse(body)).toBe(true);
    expect(body.choices[0].message.content).toBe("Four");
    expect(body.choices[0].message.reasoning_content).toBe("We need answer in one word.");
    expect(body.choices[0].response_error).toBeUndefined();
  });

  it("keeps the answer when a forced stream is collapsed to JSON", () => {
    const sse = [
      `data: ${JSON.stringify({ id: "c1", choices: [{ index: 0, delta: { content: [thinkingChunk] }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "c1", choices: [{ index: 0, delta: { content: [{ type: "text", text: "Four" }] }, finish_reason: "stop" }] })}`,
      "data: [DONE]",
    ].join("\n");

    const json = parseSSEToOpenAIResponse(sse, "m");
    expect(json.choices[0].message.content).toBe("Four");
    expect(json.choices[0].message.reasoning_content).toBe("We need answer in one word.");
  });
});
