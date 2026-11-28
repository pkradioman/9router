// Shared fake API for native UI tests and the screenshot script.
// Callers pass the mock factory: vitest's vi.fn in tests, identity in scripts.

export function makeFakeApi(fn, initial = [], providerSeed = [], comboSeed = [], poolSeed = []) {
  let keys = initial.map((item) => ({ ...item }));
  let providers = providerSeed.map((item) => ({ ...item }));
  let combos = comboSeed.map((item) => ({ ...item }));
  let pools = poolSeed.map((item) => ({ ...item }));
  let nodes = [];
  let cooldowns = [
    { provider: "openai", model: "gpt-4o", status: "cooldown", until: "2099-01-01T00:00:00.000Z", connectionId: "p1", connectionName: "Work" },
    { provider: "anthropic", model: "__all", status: "unavailable", connectionId: "p2", connectionName: "Backup" },
  ];
  let fakePricing = {
    openai: {
      "gpt-4o": { input: 2.5, output: 10, cached: 1.25 },
      "gpt-4o-mini": { input: 0.15, output: 0.6 },
    },
    anthropic: { "claude-sonnet": { input: 3, output: 15 } },
  };
  let fakeSettings = {
    cavemanEnabled: false,
    cavemanLevel: "full",
    rtkEnabled: true,
    requireLogin: true,
    requireApiKey: true,
    comboStrategies: {},
    providerStrategies: {},
    outboundProxyEnabled: false,
    outboundProxyUrl: "",
    outboundNoProxy: "",
    tunnelDashboardAccess: false,
    hasPassword: true,
  };
  let nextId = keys.length + 1;
  const api = {
    listKeys: fn(async () => keys.map((item) => ({ ...item }))),
    createKey: fn(async (name) => {
      const created = { id: `k${nextId++}`, name, key: `sk-new-${name}`, isActive: true };
      keys = [created, ...keys];
      return created;
    }),
    updateKey: fn(async (id, patch) => {
      keys = keys.map((item) => (item.id === id ? { ...item, ...patch } : item));
      return { key: keys.find((item) => item.id === id) };
    }),
    deleteKey: fn(async (id) => {
      keys = keys.filter((item) => item.id !== id);
      return {};
    }),
    listProviders: fn(async () => providers.map((item) => ({ ...item }))),
    updateProvider: fn(async (id, patch) => {
      providers = providers.map((item) => (item.id === id ? { ...item, ...patch } : item));
      return { provider: providers.find((item) => item.id === id) };
    }),
    createProvider: fn(async (body) => {
      const created = { id: `p${providers.length + 1}`, name: body.name || body.provider, provider: body.provider, authType: "apikey", isActive: true };
      providers = [created, ...providers];
      return { provider: created };
    }),
    deleteProvider: fn(async (id) => {
      providers = providers.filter((item) => item.id !== id);
      return { success: true };
    }),
    validateProvider: fn(async (_provider, apiKey) =>
      apiKey === "sk-bad" ? { valid: false, error: "invalid key" } : { valid: true }
    ),
    testProvider: fn(async (id) => {
      if (id === "p2") return { valid: false, error: "invalid key" };
      return { valid: true, refreshed: false };
    }),
    getModels: fn(async () => [
      { provider: "openai", model: "gpt-4o", name: "GPT-4o", fullModel: "openai/gpt-4o", routedModel: "openai/gpt-4o", alias: "gpt-4o", caps: { vision: true } },
      { provider: "openai", model: "gpt-4o-mini", name: "GPT-4o mini", fullModel: "openai/gpt-4o-mini", routedModel: "openai/gpt-4o-mini", alias: "mini", caps: {} },
      { provider: "openai", model: "my-model", name: "my-model", fullModel: "openai/my-model", routedModel: "openai/my-model", alias: "my-model", caps: {} },
      { provider: "anthropic", model: "claude-sonnet", name: "Claude Sonnet", fullModel: "anthropic/claude-sonnet", routedModel: "anthropic/claude-sonnet", alias: "claude-sonnet", caps: { reasoning: true } },
    ]),
    getDisabledModels: fn(async () => ({ openai: ["gpt-4o-mini", "dall-e-3"] })),
    disableModels: fn(async () => ({ success: true })),
    enableModel: fn(async () => ({ success: true })),
    enableAllModels: fn(async () => ({ success: true })),
    listCustomModels: fn(async () => [
      { providerAlias: "openai", id: "my-model", kind: "llm" },
      { providerAlias: "openai", id: "gpt-image-x", kind: "image" },
    ]),
    addCustomModel: fn(async () => ({ success: true })),
    deleteCustomModel: fn(async () => ({ success: true })),
    setModelAlias: fn(async () => ({ success: true })),
    deleteModelAlias: fn(async () => ({ success: true })),
    testModel: fn(async (model) =>
      model.includes("mini") ? { ok: false, error: "unreachable" } : { ok: true }
    ),
    getUsageStats: fn(async (period) => ({
      totalRequests: period === "7d" ? 42 : 7,
      totalPromptTokens: 1000,
      totalCompletionTokens: 200,
      totalCost: 0.1234,
      totalCachedTokens: 400,
      byProvider: { openai: { requests: 40, promptTokens: 900, completionTokens: 180, cost: 0.11 } },
      byModel: {
        "gpt-4o (openai)": { requests: 30, promptTokens: 700, completionTokens: 140, cost: 0.09 },
        "claude-sonnet (anthropic)": { requests: 12, promptTokens: 300, completionTokens: 40, cost: 0.03 },
      },
      recentRequests: [
        { timestamp: "2026-11-28T01:00:00Z", model: "gpt-4o", provider: "openai", promptTokens: 10, completionTokens: 5 },
      ],
    })),
    getUsageChart: fn(async () => [
      { label: "Mon", tokens: 40, cost: 0, requests: 1 },
      { label: "Tue", tokens: 120, cost: 0, requests: 2 },
    ]),
    listCombos: fn(async () => combos.map((item) => ({ ...item }))),
    createCombo: fn(async (name, kind = null) => {
      const created = { id: `c${combos.length + 1}`, name, kind: kind || null, models: [] };
      combos = [created, ...combos];
      return created;
    }),
    updateCombo: fn(async (id, patch) => {
      combos = combos.map((item) => (item.id === id ? { ...item, ...patch } : item));
      return { combo: combos.find((item) => item.id === id) };
    }),
    getComboPresets: fn(async (source) => ({
      source,
      items: [
        { name: `${source}-fast`, models: ["openai/gpt-4o"], exists: false },
        { name: `${source}-old`, models: [], exists: true },
      ],
      toCreate: 1,
      toSkip: 1,
    })),
    createComboPresets: fn(async (source) => ({ created: [`${source}-fast`] })),
    deleteCombo: fn(async (id) => {
      combos = combos.filter((item) => item.id !== id);
      return { success: true };
    }),
    getConsoleLogs: fn(async () => ["[INFO] gateway booted", "[ERROR] upstream refused"]),
    clearConsoleLogs: fn(async () => ({ success: true })),
    getSettings: fn(async () => ({ ...fakeSettings })),
    getTunnelStatus: fn(async () => ({
      tunnel: { publicUrl: "https://probe.trycloudflare.com" },
      tailscale: null,
      download: {},
    })),
    patchSettings: fn(async (patch) => {
      fakeSettings = { ...fakeSettings, ...patch };
      return fakeSettings;
    }),
    testProxyUrl: fn(async () => ({ ok: true, status: 200, elapsedMs: 12 })),
    getTokenSaverStats: fn(async () => ({
      rtk: { hitRequests: 3, bytesSaved: 1200 },
      caveman: { onRequests: 5, offRequests: 1 },
    })),
    getHeadroomStatus: fn(async () => ({
      installed: true,
      running: false,
      version: "0.9.1",
      url: "http://127.0.0.1:5757",
    })),
    getDatabaseBackup: fn(async () => ({ version: 1, marker: "db" })),
    importDatabase: fn(async () => ({ success: true })),
    getConnectionUsage: fn(async (id) => {
      if (id === "p2") throw new Error("expired token");
      if (id === "p3") return { quotas: { day: { used: 95, total: 100 } } };
      return {
        quotas: {
          five_hour: { used: 10, total: 100, resetAt: "2026-11-28T08:00:00.000Z" },
          seven_day: { used: 40, total: 200 },
        },
      };
    }),
    getUsageProviders: fn(async () => [
      { id: "openai", name: "OpenAI" },
      { id: "anthropic", name: "Anthropic" },
    ]),
    createChatCompletion: fn(async ({ model }) => ({
      choices: [{ message: { role: "assistant", content: `reply from ${model}` } }],
    })),
    streamChatCompletion: fn(async ({ model, onDelta }) => {
      onDelta("reply from ");
      onDelta(model);
      return {};
    }),
    getModelAvailability: fn(async () => ({
      models: cooldowns.map((item) => ({ ...item })),
      unavailableCount: cooldowns.length,
    })),
    clearModelCooldown: fn(async (provider, model) => {
      cooldowns = cooldowns.filter((item) => !(item.provider === provider && item.model === model));
      return { ok: true };
    }),
    getPricing: fn(async () => JSON.parse(JSON.stringify(fakePricing))),
    patchPricing: fn(async (payload) => {
      for (const [provider, models] of Object.entries(payload)) {
        fakePricing[provider] = { ...(fakePricing[provider] || {}) };
        for (const [model, entry] of Object.entries(models)) fakePricing[provider][model] = { ...entry };
      }
      return fakePricing;
    }),
    resetPricing: fn(async (provider = null, model = null) => {
      if (!provider) fakePricing = {};
      else if (!model) delete fakePricing[provider];
      else if (fakePricing[provider]) {
        delete fakePricing[provider][model];
        if (Object.keys(fakePricing[provider]).length === 0) delete fakePricing[provider];
      }
      return fakePricing;
    }),
    listProxyPools: fn(async () => pools.map((item) => ({ ...item }))),
    createProxyPool: fn(async (pool) => {
      const created = { id: `pp${pools.length + 1}`, isActive: true, type: "http", ...pool };
      pools = [created, ...pools];
      return { proxyPool: created };
    }),
    updateProxyPool: fn(async (id, patch) => {
      pools = pools.map((item) => (item.id === id ? { ...item, ...patch } : item));
      return { proxyPool: pools.find((item) => item.id === id) };
    }),
    deleteProxyPool: fn(async (id) => {
      pools = pools.filter((item) => item.id !== id);
      return { success: true };
    }),
    testProxyPool: fn(async (id) => ({
      ok: id !== "pp2",
      status: id === "pp2" ? 502 : 200,
      error: id === "pp2" ? "connect ECONNREFUSED" : null,
      elapsedMs: 42,
      testedAt: "2026-11-28T02:00:00.000Z",
    })),
    getCliToolStatuses: fn(async () => ({
      claude: { installed: true, has9Router: true },
      codex: { installed: true, has9Router: false },
      droid: { installed: false },
      hermes: null,
    })),
    getTranslatorFile: fn(async (file) => `{"file":"${file}","marker":"body"}`),
    saveTranslatorFile: fn(async () => ({ success: true })),
    listProviderNodes: fn(async () => nodes.map((node) => ({ ...node }))),
    createProviderNode: fn(async (body) => {
      const prefix =
        body.type === "anthropic-compatible"
          ? "anthropic-compatible"
          : body.type === "custom-embedding"
            ? "custom-embedding"
            : `openai-compatible-${body.apiType || "chat"}`;
      const created = { id: `${prefix}-${nodes.length + 1}`, apiType: "chat", ...body };
      nodes = [created, ...nodes];
      return { node: created };
    }),
    deleteProviderNode: fn(async (id) => {
      nodes = nodes.filter((node) => node.id !== id);
      return { success: true };
    }),
    updateProviderNode: fn(async (id, patch) => {
      nodes = nodes.map((node) => (node.id === id ? { ...node, ...patch } : node));
      return { node: nodes.find((node) => node.id === id) };
    }),
    getRequestDetails: fn(async (page, pageSize) => ({
      details: [
        {
          id: `d${page}`,
          model: page === 1 ? "gpt-4o" : "claude-sonnet",
          provider: "openai",
          status: 200,
          timestamp: "2026-11-28T02:00:00.000Z",
          tokens: { prompt_tokens: 1200, completion_tokens: 340, cached_tokens: 800, cache_creation_input_tokens: 64 },
          latency: { ttft: 210, total: 940 },
          cost: 0.0042,
          connectionId: "p1",
        },
      ],
      pagination: { page, pageSize, totalItems: 21, totalPages: 2, hasNext: page < 2, hasPrev: page > 1 },
    })),
  };
  api.snapshot = () => keys;
  return api;
}

