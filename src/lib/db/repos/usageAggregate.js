// Pure day-bucket aggregation for usageDaily. Kept free of app aliases so the
// offline repair script (scripts/repair-usage-costs.mjs) can import this exact
// logic instead of keeping a second copy that can drift.

export const COST_COMPONENT_KEYS = ["inputCost", "cachedCost", "outputCost", "reasoningCost", "cacheCreationCost"];

export function getLocalDateKey(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addCostComponents(target, src) {
  if (!src) return;
  for (const key of COST_COMPONENT_KEYS) target[key] = (target[key] || 0) + (src[key] || 0);
  target.unpriced = (target.unpriced || 0) + (src.unpriced || 0);
}

function addToCounter(target, key, values) {
  if (!target[key]) {
    target[key] = {
      requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0,
      inputCost: 0, cachedCost: 0, outputCost: 0, reasoningCost: 0, cacheCreationCost: 0, unpriced: 0,
    };
  }
  target[key].requests += values.requests || 1;
  target[key].promptTokens += values.promptTokens || 0;
  target[key].completionTokens += values.completionTokens || 0;
  target[key].cachedTokens += values.cachedTokens || 0;
  target[key].cost += values.cost || 0;
  addCostComponents(target[key], values);
  if (values.meta) Object.assign(target[key], values.meta);
}

// `entry.costComponents` is { input, cached, output, reasoning, cacheCreation }.
export function aggregateEntryToDay(day, entry) {
  const promptTokens = entry.tokens?.prompt_tokens || entry.tokens?.input_tokens || 0;
  const completionTokens = entry.tokens?.completion_tokens || entry.tokens?.output_tokens || 0;
  const cachedTokens = entry.tokens?.cached_tokens || entry.tokens?.cache_read_input_tokens || 0;
  const cost = entry.cost || 0;
  const components = entry.costComponents || null;
  const vals = {
    promptTokens, completionTokens, cachedTokens, cost,
    inputCost: components?.input || 0,
    cachedCost: components?.cached || 0,
    outputCost: components?.output || 0,
    reasoningCost: components?.reasoning || 0,
    cacheCreationCost: components?.cacheCreation || 0,
    unpriced: entry.priced === false ? 1 : 0,
  };

  day.requests = (day.requests || 0) + 1;
  day.promptTokens = (day.promptTokens || 0) + promptTokens;
  day.completionTokens = (day.completionTokens || 0) + completionTokens;
  day.cachedTokens = (day.cachedTokens || 0) + cachedTokens;
  day.cost = (day.cost || 0) + cost;
  addCostComponents(day, vals);

  day.byProvider ||= {};
  day.byModel ||= {};
  day.byAccount ||= {};
  day.byApiKey ||= {};
  day.byEndpoint ||= {};

  if (entry.provider) addToCounter(day.byProvider, entry.provider, vals);

  const modelKey = entry.provider ? `${entry.model}|${entry.provider}` : entry.model;
  addToCounter(day.byModel, modelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });

  if (entry.connectionId) {
    addToCounter(day.byAccount, entry.connectionId, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });
  }

  const apiKeyVal = entry.apiKey && typeof entry.apiKey === "string" ? entry.apiKey : "local-no-key";
  const akModelKey = `${apiKeyVal}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byApiKey, akModelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider, apiKey: entry.apiKey || null } });

  const endpoint = entry.endpoint || "Unknown";
  const epKey = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byEndpoint, epKey, { ...vals, meta: { endpoint, rawModel: entry.model, provider: entry.provider } });
}
