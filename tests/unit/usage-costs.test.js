import { describe, it, expect } from "vitest";

import {
  calculateCostBreakdown,
  calculateCostFromTokens,
  getExactPricingForModel,
} from "../../open-sse/providers/pricing.js";
import { aggregateEntryToDay } from "../../src/lib/db/repos/usageAggregate.js";

describe("cost resolution", () => {
  it("never globs a model name for a custom OpenAI-compatible node", () => {
    expect(getExactPricingForModel("openai-compatible-chat-x", "deepseek-v4-1-flash-1017")).toBeNull();
    expect(getExactPricingForModel("openai-compatible-chat-x", "deepseek-ai/DeepSeek-V4.1-Flash-1017")).toBeNull();
  });

  it("still resolves exact canonical ids for custom nodes", () => {
    expect(getExactPricingForModel("openai-compatible-chat-x", "gpt-6.1-terra")?.input).toBe(1);
  });

  it("keeps canonical pricing for built-in providers", () => {
    const tex = getExactPricingForModel("codex", "gpt-6.1-terra");
    expect(tex).toMatchObject({ input: 1, output: 5, cached: 0.05 });
  });
});

describe("calculateCostBreakdown", () => {
  const tokens = {
    prompt_tokens: 1000,
    cached_tokens: 900,
    completion_tokens: 100,
    reasoning_tokens: 80,
  };
  const pricing = { input: 0.3, output: 1.2, cached: 0.007, reasoning: 1.2, cache_creation: 0 };

  it("does not charge reasoning twice when it is part of completion", () => {
    const c = calculateCostBreakdown(tokens, pricing);
    expect(c.input).toBeCloseTo(100 * 0.3 / 1e6, 12);
    expect(c.cached).toBeCloseTo(900 * 0.007 / 1e6, 12);
    expect(c.output).toBeCloseTo(100 * 1.2 / 1e6, 12);
    expect(c.reasoning).toBe(0);
    expect(c.total).toBeCloseTo(c.input + c.cached + c.output, 12);
  });

  it("does charge reasoning separately when the usage says it is outside completion", () => {
    const c = calculateCostBreakdown({ ...tokens, reasoning_separate: true }, pricing);
    expect(c.reasoning).toBeCloseTo(80 * 1.2 / 1e6, 12);
    expect(c.total).toBeCloseTo(c.input + c.cached + c.output + c.reasoning, 12);
  });

  it("matches calculateCostFromTokens", () => {
    expect(calculateCostFromTokens(tokens, pricing)).toBeCloseTo(calculateCostBreakdown(tokens, pricing).total, 12);
  });

  it("returns zeros without pricing instead of throwing", () => {
    expect(calculateCostBreakdown(tokens, null)).toEqual({ input: 0, cached: 0, output: 0, reasoning: 0, cacheCreation: 0, total: 0 });
  });
});

describe("usage aggregation components", () => {
  it("carries component costs and unpriced counts into day buckets", () => {
    const day = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {} };
    aggregateEntryToDay(day, {
      timestamp: "2026-11-20T01:00:00.000Z",
      provider: "openai-compatible-chat-x",
      model: "m",
      connectionId: "c1",
      apiKey: "k",
      endpoint: "/v1/chat/completions",
      tokens: { prompt_tokens: 100, completion_tokens: 10, cached_tokens: 80 },
      cost: 0.5,
      priced: true,
      costComponents: { input: 0.1, cached: 0.2, output: 0.2, reasoning: 0, cacheCreation: 0, total: 0.5 },
    });
    aggregateEntryToDay(day, {
      timestamp: "2026-11-20T02:00:00.000Z",
      provider: "openai-compatible-chat-y",
      model: "n",
      tokens: { prompt_tokens: 5, completion_tokens: 1 },
      cost: 0,
      priced: false,
      costComponents: null,
    });

    expect(day.cost).toBeCloseTo(0.5, 12);
    expect(day.inputCost).toBeCloseTo(0.1, 12);
    expect(day.cachedCost).toBeCloseTo(0.2, 12);
    expect(day.outputCost).toBeCloseTo(0.2, 12);
    expect(day.unpriced).toBe(1);
    expect(day.byProvider["openai-compatible-chat-x"].cost).toBeCloseTo(0.5, 12);
    expect(day.byProvider["openai-compatible-chat-x"].inputCost).toBeCloseTo(0.1, 12);
  });
});
