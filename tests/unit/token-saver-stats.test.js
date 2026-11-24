import { describe, it, expect } from "vitest";
import { summarizeSaverRows } from "../../src/lib/tokenSaver/stats.js";

function row({ ts = "2026-11-24T10:00:00.000Z", provider = "mistral-vibe", model = "m",
  prompt = 1000, completion = 100, cached = 0, saver = null } = {}) {
  return {
    timestamp: ts,
    provider,
    model,
    tokens: { prompt_tokens: prompt, completion_tokens: completion, cached_tokens: cached },
    meta: saver ? { saver } : {},
  };
}

const rtkSaver = ({ enabled = true, before = 800, after = 200, hits = 1, filters = { "git-diff": 600 } } = {}) => ({
  v: 1,
  rtk: { enabled, bytesBefore: before, bytesAfter: after, bytesSaved: before - after, hits, filters },
  caveman: null,
});

describe("token saver stats", () => {
  it("ignores rows from before instrumentation", () => {
    const s = summarizeSaverRows([row({ saver: null }), { ...row(), meta: { saver: { rtk: {} } } }]);
    expect(s.instrumented.requests).toBe(0);
    expect(s.rtk.hitRequests).toBe(0);
  });

  it("measures RTK coverage, bytes, tokens and prompt share", () => {
    const s = summarizeSaverRows([
      row({ saver: rtkSaver({ before: 2000, after: 400 }) }),
      row({ saver: rtkSaver({ enabled: true, before: 0, after: 0, hits: 0, filters: {} }) }),
      row({ saver: rtkSaver({ enabled: false, before: 0, after: 0, hits: 0, filters: {} }) }),
    ]);

    expect(s.instrumented.requests).toBe(3);
    expect(s.rtk.enabledRequests).toBe(2);
    expect(s.rtk.hitRequests).toBe(1);
    expect(s.rtk.coveragePct).toBe(50);
    expect(s.rtk.bytesSaved).toBe(1600);
    expect(s.rtk.tokensSavedEst).toBe(400);
    // promptTokens is post-compression: 2 x 1000; avoided tokens are added back.
    expect(s.rtk.promptTokens).toBe(2000);
    expect(s.rtk.promptSharePct).toBe(16.7);
    expect(s.rtk.filters).toEqual([{ filter: "git-diff", bytes: 600, requests: 1 }]);
  });

  it("compares cache rate for hit and non-hit requests", () => {
    const s = summarizeSaverRows([
      row({ saver: rtkSaver(), prompt: 1000, cached: 100 }),
      row({ saver: rtkSaver({ enabled: true, before: 0, after: 0, hits: 0, filters: {} }), prompt: 1000, cached: 800 }),
    ]);
    expect(s.rtk.cache.hit.requests).toBe(1);
    expect(s.rtk.cache.hit.cacheRatePct).toBe(10);
    expect(s.rtk.cache.miss.requests).toBe(1);
    expect(s.rtk.cache.miss.cacheRatePct).toBe(80);
  });

  it("builds caveman on/off cohorts per model", () => {
    const caveman = (level) => ({ v: 1, rtk: { enabled: false }, caveman: level ? { level } : null });
    const s = summarizeSaverRows([
      row({ model: "a", completion: 400, saver: caveman("full") }),
      row({ model: "a", completion: 600, saver: caveman("full") }),
      row({ model: "a", completion: 1000, saver: caveman(null) }),
      row({ model: "b", completion: 50, saver: caveman("full") }),
    ]);

    expect(s.caveman.onRequests).toBe(3);
    expect(s.caveman.offRequests).toBe(1);
    expect(s.caveman.levels).toEqual({ full: 3 });

    const a = s.caveman.models.find((m) => m.model === "a");
    expect(a.comparable).toBe(true);
    expect(a.on.avgOutputTokens).toBe(500);
    expect(a.off.avgOutputTokens).toBe(1000);
    expect(a.on.requests).toBe(2);

    const b = s.caveman.models.find((m) => m.model === "b");
    expect(b.comparable).toBe(false);
    expect(b.off.requests).toBe(0);
  });

  it("returns a zeroed summary for an empty window", () => {
    const s = summarizeSaverRows([]);
    expect(s.instrumented.requests).toBe(0);
    expect(s.rtk.coveragePct).toBe(0);
    expect(s.caveman.models).toEqual([]);
  });
});
