// Pure aggregation for the Token Saver effectiveness dashboard.
//
// Rows are usageHistory records: { timestamp, provider, model, tokens, meta }.
// Only rows with meta.saver.v are used: before instrumentation nothing was
// recorded, and treating those older rows as "caveman off" would fabricate an
// off cohort out of missing data.

export const SAVER_PERIODS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "60d": 60 * 24 * 60 * 60 * 1000,
  all: null,
};

const BYTES_PER_TOKEN = 4;

function asObject(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function pct(part, whole) {
  if (!whole) return 0;
  return +((part / whole) * 100).toFixed(1);
}

function emptyBucket() {
  return { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, firstAt: null, lastAt: null };
}

function addToBucket(bucket, row) {
  const tokens = asObject(row.tokens) || {};
  bucket.requests++;
  bucket.promptTokens += tokens.prompt_tokens || tokens.input_tokens || 0;
  bucket.completionTokens += tokens.completion_tokens || tokens.output_tokens || 0;
  bucket.cachedTokens += tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
  if (!bucket.firstAt || row.timestamp < bucket.firstAt) bucket.firstAt = row.timestamp;
  if (!bucket.lastAt || row.timestamp > bucket.lastAt) bucket.lastAt = row.timestamp;
}

function finishBucket(bucket) {
  return {
    ...bucket,
    avgOutputTokens: bucket.requests ? +(bucket.completionTokens / bucket.requests).toFixed(1) : 0,
    avgPromptTokens: bucket.requests ? +(bucket.promptTokens / bucket.requests).toFixed(1) : 0,
    cacheRatePct: bucket.promptTokens ? pct(bucket.cachedTokens, bucket.promptTokens) : null,
  };
}

export function summarizeSaverRows(rows) {
  const instrumented = { requests: 0, firstAt: null, lastAt: null };
  const rtk = {
    enabledRequests: 0, hitRequests: 0,
    bytesBefore: 0, bytesAfter: 0, bytesSaved: 0,
    promptTokens: 0,
    filters: new Map(),
    cacheHit: emptyBucket(),
    cacheMiss: emptyBucket(),
    byModel: new Map(),
  };
  const caveman = { onRequests: 0, offRequests: 0, levels: {}, models: new Map() };

  for (const row of rows || []) {
    const meta = asObject(row.meta);
    const saver = meta?.saver;
    if (!saver || saver.v !== 1) continue;

    const tokens = asObject(row.tokens) || {};
    const promptTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
    const hit = (saver.rtk?.bytesSaved || 0) > 0;

    instrumented.requests++;
    if (!instrumented.firstAt || row.timestamp < instrumented.firstAt) instrumented.firstAt = row.timestamp;
    if (!instrumented.lastAt || row.timestamp > instrumented.lastAt) instrumented.lastAt = row.timestamp;

    if (saver.rtk?.enabled) {
      rtk.enabledRequests++;
      rtk.promptTokens += promptTokens;
      if (hit) {
        rtk.hitRequests++;
        const saved = saver.rtk.bytesSaved || 0;
        rtk.bytesBefore += saver.rtk.bytesBefore || 0;
        rtk.bytesAfter += saver.rtk.bytesAfter || 0;
        rtk.bytesSaved += saved;

        for (const [filter, bytes] of Object.entries(saver.rtk.filters || {})) {
          const entry = rtk.filters.get(filter) || { filter, bytes: 0, requests: 0 };
          entry.bytes += bytes || 0;
          entry.requests++;
          rtk.filters.set(filter, entry);
        }

        const modelKey = `${row.provider || "unknown"}|${row.model || "unknown"}`;
        const model = rtk.byModel.get(modelKey) || {
          provider: row.provider || "unknown", model: row.model || "unknown",
          requests: 0, hitRequests: 0, bytesSaved: 0,
        };
        model.requests++;
        model.hitRequests++;
        model.bytesSaved += saved;
        rtk.byModel.set(modelKey, model);
      }
      addToBucket(hit ? rtk.cacheHit : rtk.cacheMiss, row);
    }

    const level = saver.caveman?.level || null;
    const cohortKey = `${row.provider || "unknown"}|${row.model || "unknown"}`;
    const cohort = caveman.models.get(cohortKey) || {
      provider: row.provider || "unknown", model: row.model || "unknown",
      on: emptyBucket(), off: emptyBucket(),
    };
    if (level) {
      caveman.onRequests++;
      caveman.levels[level] = (caveman.levels[level] || 0) + 1;
      addToBucket(cohort.on, row);
    } else {
      caveman.offRequests++;
      addToBucket(cohort.off, row);
    }
    caveman.models.set(cohortKey, cohort);
  }

  const tokensSavedEst = Math.round(rtk.bytesSaved / BYTES_PER_TOKEN);
  const models = [...rtk.byModel.values()]
    .map((m) => ({ ...m, tokensSavedEst: Math.round(m.bytesSaved / BYTES_PER_TOKEN) }))
    .sort((a, b) => b.bytesSaved - a.bytesSaved);

  return {
    instrumented,
    rtk: {
      enabledRequests: rtk.enabledRequests,
      hitRequests: rtk.hitRequests,
      coveragePct: pct(rtk.hitRequests, rtk.enabledRequests),
      bytesBefore: rtk.bytesBefore,
      bytesAfter: rtk.bytesAfter,
      bytesSaved: rtk.bytesSaved,
      tokensSavedEst,
      promptTokens: rtk.promptTokens,
      // promptTokens is post-compression; add the avoided tokens back to get the
      // share of the prompt RTK removed.
      promptSharePct: pct(tokensSavedEst, rtk.promptTokens + tokensSavedEst),
      filters: [...rtk.filters.values()].sort((a, b) => b.bytes - a.bytes),
      cache: {
        hit: finishBucket(rtk.cacheHit),
        miss: finishBucket(rtk.cacheMiss),
      },
      byModel: models,
    },
    caveman: {
      onRequests: caveman.onRequests,
      offRequests: caveman.offRequests,
      levels: caveman.levels,
      models: [...caveman.models.values()]
        .map((m) => ({
          provider: m.provider,
          model: m.model,
          on: finishBucket(m.on),
          off: finishBucket(m.off),
          comparable: m.on.requests > 0 && m.off.requests > 0,
        }))
        .sort((a, b) => (b.on.requests + b.off.requests) - (a.on.requests + a.off.requests)),
    },
  };
}
