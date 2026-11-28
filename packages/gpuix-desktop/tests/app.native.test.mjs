// Native rendering + interaction checks for the app shell and Endpoint page.
// The API is injected, so these tests exercise the real GPUIX paint/hit-test
// pipeline without a live gateway.
import { describe, expect, it, vi } from "vitest";

const gpuix = await import("@gpuix/react/testing");
const { hasNativeTestRenderer, createTestRoot } = gpuix;
const React = (await import("react")).default;
const { App } = await import("../src/ui/App.mjs");
const { STATUS } = await import("../src/ui/status-model.mjs");

const h = React.createElement;

async function settle(root) {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.renderer.flush();
  }
}

function status(overrides = {}) {
  return {
    phase: STATUS.ready,
    port: 20129,
    baseUrl: "http://127.0.0.1:20129",
    dataDir: "C:\\Users\\example\\AppData\\Roaming\\9router-gpuix",
    runtimeDir: "C:\\rt",
    version: "0.5.126",
    latestVersion: null,
    hasUpdate: false,
    lastError: null,
    checkedAt: null,
    ...overrides,
  };
}

// One native test window per file. TestGpuixRenderer opens a real GPUI window
// and has no close call, so creating a root per test left a window (and its
// GPU context) open until the process exited. Re-render with a new key so the
// previous tree unmounts instead.
let sharedRoot = null;
let mountKey = 0;
function mount(api) {
  if (!sharedRoot) sharedRoot = createTestRoot({ width: 1200, height: 1800 });
  mountKey += 1;
  sharedRoot.render(h(App, { key: mountKey, api, status: status(), onRefresh: () => {} }));
  return sharedRoot;
}


function createFakeApi(initial = [], providerSeed = [], comboSeed = [], poolSeed = []) {
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
    listKeys: vi.fn(async () => keys.map((item) => ({ ...item }))),
    createKey: vi.fn(async (name) => {
      const created = { id: `k${nextId++}`, name, key: `sk-new-${name}`, isActive: true };
      keys = [created, ...keys];
      return created;
    }),
    updateKey: vi.fn(async (id, patch) => {
      keys = keys.map((item) => (item.id === id ? { ...item, ...patch } : item));
      return { key: keys.find((item) => item.id === id) };
    }),
    deleteKey: vi.fn(async (id) => {
      keys = keys.filter((item) => item.id !== id);
      return {};
    }),
    listProviders: vi.fn(async () => providers.map((item) => ({ ...item }))),
    updateProvider: vi.fn(async (id, patch) => {
      providers = providers.map((item) => (item.id === id ? { ...item, ...patch } : item));
      return { provider: providers.find((item) => item.id === id) };
    }),
    createProvider: vi.fn(async (body) => {
      const created = { id: `p${providers.length + 1}`, name: body.name || body.provider, provider: body.provider, authType: "apikey", isActive: true };
      providers = [created, ...providers];
      return { provider: created };
    }),
    deleteProvider: vi.fn(async (id) => {
      providers = providers.filter((item) => item.id !== id);
      return { success: true };
    }),
    validateProvider: vi.fn(async (_provider, apiKey) =>
      apiKey === "sk-bad" ? { valid: false, error: "invalid key" } : { valid: true }
    ),
    testProvider: vi.fn(async (id) => {
      if (id === "p2") return { valid: false, error: "invalid key" };
      return { valid: true, refreshed: false };
    }),
    getModels: vi.fn(async () => [
      { provider: "openai", model: "gpt-4o", name: "GPT-4o", fullModel: "openai/gpt-4o", routedModel: "openai/gpt-4o", alias: "gpt-4o", caps: { vision: true } },
      { provider: "openai", model: "gpt-4o-mini", name: "GPT-4o mini", fullModel: "openai/gpt-4o-mini", routedModel: "openai/gpt-4o-mini", alias: "mini", caps: {} },
      { provider: "openai", model: "my-model", name: "my-model", fullModel: "openai/my-model", routedModel: "openai/my-model", alias: "my-model", caps: {} },
      { provider: "anthropic", model: "claude-sonnet", name: "Claude Sonnet", fullModel: "anthropic/claude-sonnet", routedModel: "anthropic/claude-sonnet", alias: "claude-sonnet", caps: { reasoning: true } },
    ]),
    getDisabledModels: vi.fn(async () => ({ openai: ["gpt-4o-mini", "dall-e-3"] })),
    disableModels: vi.fn(async () => ({ success: true })),
    enableModel: vi.fn(async () => ({ success: true })),
    enableAllModels: vi.fn(async () => ({ success: true })),
    listCustomModels: vi.fn(async () => [
      { providerAlias: "openai", id: "my-model", kind: "llm" },
      { providerAlias: "openai", id: "gpt-image-x", kind: "image" },
    ]),
    addCustomModel: vi.fn(async () => ({ success: true })),
    deleteCustomModel: vi.fn(async () => ({ success: true })),
    setModelAlias: vi.fn(async () => ({ success: true })),
    deleteModelAlias: vi.fn(async () => ({ success: true })),
    testModel: vi.fn(async (model) =>
      model.includes("mini") ? { ok: false, error: "unreachable" } : { ok: true }
    ),
    getUsageStats: vi.fn(async (period) => ({
      totalRequests: period === "7d" ? 42 : 7,
      totalPromptTokens: 1000,
      totalCompletionTokens: 200,
      totalCost: 0.1234,
      byProvider: { openai: { requests: 40, promptTokens: 900, completionTokens: 180, cost: 0.11 } },
      recentRequests: [
        { timestamp: "2026-11-28T01:00:00Z", model: "gpt-4o", provider: "openai", promptTokens: 10, completionTokens: 5 },
      ],
    })),
    getUsageChart: vi.fn(async () => [
      { label: "Mon", tokens: 40, cost: 0, requests: 1 },
      { label: "Tue", tokens: 120, cost: 0, requests: 2 },
    ]),
    listCombos: vi.fn(async () => combos.map((item) => ({ ...item }))),
    createCombo: vi.fn(async (name, kind = null) => {
      const created = { id: `c${combos.length + 1}`, name, kind: kind || null, models: [] };
      combos = [created, ...combos];
      return created;
    }),
    updateCombo: vi.fn(async (id, patch) => {
      combos = combos.map((item) => (item.id === id ? { ...item, ...patch } : item));
      return { combo: combos.find((item) => item.id === id) };
    }),
    getComboPresets: vi.fn(async (source) => ({
      source,
      items: [
        { name: `${source}-fast`, models: ["openai/gpt-4o"], exists: false },
        { name: `${source}-old`, models: [], exists: true },
      ],
      toCreate: 1,
      toSkip: 1,
    })),
    createComboPresets: vi.fn(async (source) => ({ created: [`${source}-fast`] })),
    deleteCombo: vi.fn(async (id) => {
      combos = combos.filter((item) => item.id !== id);
      return { success: true };
    }),
    getConsoleLogs: vi.fn(async () => ["[INFO] gateway booted", "[ERROR] upstream refused"]),
    clearConsoleLogs: vi.fn(async () => ({ success: true })),
    getSettings: vi.fn(async () => ({ ...fakeSettings })),
    getTunnelStatus: vi.fn(async () => ({
      tunnel: { publicUrl: "https://probe.trycloudflare.com" },
      tailscale: null,
      download: {},
    })),
    patchSettings: vi.fn(async (patch) => {
      fakeSettings = { ...fakeSettings, ...patch };
      return fakeSettings;
    }),
    testProxyUrl: vi.fn(async () => ({ ok: true, status: 200, elapsedMs: 12 })),
    getTokenSaverStats: vi.fn(async () => ({
      rtk: { hitRequests: 3, bytesSaved: 1200 },
      caveman: { onRequests: 5, offRequests: 1 },
    })),
    getHeadroomStatus: vi.fn(async () => ({
      installed: true,
      running: false,
      version: "0.9.1",
      url: "http://127.0.0.1:5757",
    })),
    getUsageProviders: vi.fn(async () => [
      { id: "openai", name: "OpenAI" },
      { id: "anthropic", name: "Anthropic" },
    ]),
    createChatCompletion: vi.fn(async ({ model }) => ({
      choices: [{ message: { role: "assistant", content: `reply from ${model}` } }],
    })),
    streamChatCompletion: vi.fn(async ({ model, onDelta }) => {
      onDelta("reply from ");
      onDelta(model);
      return {};
    }),
    getModelAvailability: vi.fn(async () => ({
      models: cooldowns.map((item) => ({ ...item })),
      unavailableCount: cooldowns.length,
    })),
    clearModelCooldown: vi.fn(async (provider, model) => {
      cooldowns = cooldowns.filter((item) => !(item.provider === provider && item.model === model));
      return { ok: true };
    }),
    getPricing: vi.fn(async () => JSON.parse(JSON.stringify(fakePricing))),
    patchPricing: vi.fn(async (payload) => {
      for (const [provider, models] of Object.entries(payload)) {
        fakePricing[provider] = { ...(fakePricing[provider] || {}) };
        for (const [model, entry] of Object.entries(models)) fakePricing[provider][model] = { ...entry };
      }
      return fakePricing;
    }),
    resetPricing: vi.fn(async (provider = null, model = null) => {
      if (!provider) fakePricing = {};
      else if (!model) delete fakePricing[provider];
      else if (fakePricing[provider]) {
        delete fakePricing[provider][model];
        if (Object.keys(fakePricing[provider]).length === 0) delete fakePricing[provider];
      }
      return fakePricing;
    }),
    listProxyPools: vi.fn(async () => pools.map((item) => ({ ...item }))),
    createProxyPool: vi.fn(async (pool) => {
      const created = { id: `pp${pools.length + 1}`, isActive: true, type: "http", ...pool };
      pools = [created, ...pools];
      return { proxyPool: created };
    }),
    updateProxyPool: vi.fn(async (id, patch) => {
      pools = pools.map((item) => (item.id === id ? { ...item, ...patch } : item));
      return { proxyPool: pools.find((item) => item.id === id) };
    }),
    deleteProxyPool: vi.fn(async (id) => {
      pools = pools.filter((item) => item.id !== id);
      return { success: true };
    }),
    testProxyPool: vi.fn(async (id) => ({
      ok: id !== "pp2",
      status: id === "pp2" ? 502 : 200,
      error: id === "pp2" ? "connect ECONNREFUSED" : null,
      elapsedMs: 42,
      testedAt: "2026-11-28T02:00:00.000Z",
    })),
    getCliToolStatuses: vi.fn(async () => ({
      claude: { installed: true, has9Router: true },
      codex: { installed: true, has9Router: false },
      droid: { installed: false },
      hermes: null,
    })),
    getTranslatorFile: vi.fn(async (file) => `{"file":"${file}","marker":"body"}`),
    listProviderNodes: vi.fn(async () => nodes.map((node) => ({ ...node }))),
    createProviderNode: vi.fn(async (body) => {
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
    deleteProviderNode: vi.fn(async (id) => {
      nodes = nodes.filter((node) => node.id !== id);
      return { success: true };
    }),
    updateProviderNode: vi.fn(async (id, patch) => {
      nodes = nodes.map((node) => (node.id === id ? { ...node, ...patch } : node));
      return { node: nodes.find((node) => node.id === id) };
    }),
    getRequestDetails: vi.fn(async (page, pageSize) => ({
      details: [
        {
          id: `d${page}`,
          model: page === 1 ? "gpt-4o" : "claude-sonnet",
          provider: "openai",
          status: 200,
          timestamp: "2026-11-28T02:00:00.000Z",
        },
      ],
      pagination: { page, pageSize, totalItems: 21, totalPages: 2, hasNext: page < 2, hasPrev: page > 1 },
    })),
  };
  api.snapshot = () => keys;
  return api;
}

function click(renderer, testId) {
  const element = renderer.findByTestId(testId);
  expect(element).toBeTruthy();
  const bounds = renderer.getElementBounds(element.id);
  renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

describe.skipIf(!hasNativeTestRenderer)("native app shell", () => {
  it("paints the endpoint rows and existing API keys", async () => {
    const api = createFakeApi([{ id: "k1", name: "laptop", key: "sk-live-1", isActive: true }]);
    const root = mount(api);
    await settle(root);

    const painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("Endpoint & Key");
    expect(painted).toContain("http://127.0.0.1:20129/v1");
    expect(painted).toContain("laptop");
    expect(painted).toContain("sk-live-1");
    expect(painted).toContain("Active");
    expect(painted).toContain("soon");
  });

  it("shows the access policy and tunnel status and toggles require-API-key", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);

    let painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("Require API key");
    expect(painted).toContain("Enabled");
    expect(painted).toContain("https://probe.trycloudflare.com");
    expect(painted).toContain("not enabled");

    click(root.renderer, "endpoint-require-key");
    await settle(root);
    expect(api.patchSettings).toHaveBeenCalledWith({ requireApiKey: false });
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("Disabled");
  });

  it("creates a key from the name field", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);

    const input = root.renderer.findByTestId("key-name-input");
    expect(input).toBeTruthy();
    const bounds = root.renderer.getElementBounds(input.id);
    root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    root.renderer.nativeSimulateKeystrokes(input.id, "d e s k");
    await settle(root);
    click(root.renderer, "key-create");
    await settle(root);

    expect(api.createKey).toHaveBeenCalledWith("desk");
    const painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("desk");
    expect(painted).toContain("sk-new-desk");
  });

  it("toggles and deletes a key", async () => {
    const api = createFakeApi([
      { id: "k1", name: "laptop", key: "sk-live-1", isActive: true },
      { id: "k2", name: "server", key: "sk-live-2", isActive: true },
    ]);
    const root = mount(api);
    await settle(root);

    click(root.renderer, "key-toggle-k1");
    await settle(root);
    expect(api.updateKey).toHaveBeenCalledWith("k1", { isActive: false });
    expect(root.renderer.getPaintedText().join("\n")).toContain("Disabled");

    click(root.renderer, "key-delete-k2");
    await settle(root);
    expect(api.deleteKey).toHaveBeenCalledWith("k2");
    expect(root.renderer.getPaintedText().join("\n")).not.toContain("server");
  });

  it("restricts a key to an allow list", async () => {
    const api = createFakeApi([
      { id: "k1", name: "laptop", key: "sk-live-1", isActive: true, access: { restricted: false, allow: [] } },
    ]);
    const root = mount(api);
    await settle(root);

    click(root.renderer, "key-access-k1");
    await settle(root);
    click(root.renderer, "key-restrict-k1");
    await settle(root);
    click(root.renderer, "key-access-save-k1");
    await settle(root);

    expect(api.updateKey).toHaveBeenCalledWith("k1", { access: { restricted: true, allow: [] } });
    const painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("Restricted");
  });

  it("shows the gateway error inline when the key list fails", async () => {
    const api = createFakeApi();
    api.listKeys.mockRejectedValueOnce(new Error("Unauthorized"));
    const root = mount(api);
    await settle(root);

    expect(root.renderer.getPaintedText().join("\n")).toContain("Unauthorized");
  });

  it("switches to the gateway status page from the sidebar", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-status");
    await settle(root);
    const painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("9Router Experimental");
    expect(painted).toContain("Gateway healthy on port 20129");
    expect(painted).toContain("Refresh status");
  });

  it("lists provider connections and toggles one from the sidebar page", async () => {
    const api = createFakeApi([], [
      { id: "p1", name: "Work OpenAI", provider: "openai", authType: "apikey", isActive: true },
      { id: "p2", name: "Claude", provider: "anthropic", authType: "oauth", isActive: false },
    ]);
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-providers");
    await settle(root);
    let painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("Work OpenAI");
    expect(painted).toContain("anthropic · oauth");
    expect(painted).toContain("Disabled");

    click(root.renderer, "provider-toggle-p1");
    await settle(root);
    expect(api.updateProvider).toHaveBeenCalledWith("p1", { isActive: false });
    const paintedAfter = root.renderer.getPaintedText().join("\n");
    expect(paintedAfter).toContain("Work OpenAI");
    expect(paintedAfter).toContain("Disabled");
  });

  it("edits a provider connection's name, model, priority and proxy binding", async () => {
    const api = createFakeApi([], [
      {
        id: "p1",
        name: "Work",
        provider: "openai",
        authType: "apikey",
        isActive: true,
        defaultModel: "gpt-4o",
        priority: 1,
        providerSpecificData: { proxyPoolId: "pp9" },
      },
    ]);
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-providers");
    await settle(root);
    const painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("gpt-4o");
    expect(painted).toContain("proxy pp9");

    click(root.renderer, "provider-edit-p1");
    await settle(root);
    expect(root.renderer.findByTestId("provider-name-edit-p1")).toBeTruthy();
    expect(root.renderer.findByTestId("provider-model-edit-p1")).toBeTruthy();
    expect(root.renderer.findByTestId("provider-priority-edit-p1")).toBeTruthy();
    expect(root.renderer.findByTestId("provider-proxy-edit-p1")).toBeTruthy();

    click(root.renderer, "provider-save-p1");
    await settle(root);
    expect(api.updateProvider).toHaveBeenCalledWith("p1", {
      name: "Work",
      defaultModel: "gpt-4o",
      priority: 1,
      proxyPoolId: "pp9",
    });
  });

  it("sets and clears a provider round-robin override", async () => {
    const api = createFakeApi([], [
      { id: "p1", name: "Work", provider: "openai", authType: "apikey", isActive: true },
      { id: "p2", name: "Backup", provider: "openai", authType: "apikey", isActive: true },
    ]);
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-providers");
    await settle(root);
    click(root.renderer, "provider-strategy-openai-rr");
    await settle(root);
    expect(api.patchSettings).toHaveBeenLastCalledWith({
      providerStrategies: { openai: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 1 } },
    });

    click(root.renderer, "provider-strategy-openai-global");
    await settle(root);
    expect(api.patchSettings).toHaveBeenLastCalledWith({ providerStrategies: {} });
  });

  it("applies a provider chip in the request log", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-request-log");
    await settle(root);
    expect(root.renderer.getPaintedText().join("\n")).toContain("Providers:");

    click(root.renderer, "request-log-provider-chip-openai");
    await settle(root);
    expect(api.getRequestDetails).toHaveBeenLastCalledWith(
      1,
      20,
      expect.objectContaining({ provider: "openai" })
    );

    click(root.renderer, "request-log-provider-chip-anthropic");
    await settle(root);
    expect(api.getRequestDetails).toHaveBeenLastCalledWith(
      1,
      20,
      expect.objectContaining({ provider: "anthropic" })
    );
  });

  it("streams a chat reply by default and falls back to one-shot when disabled", async () => {
    const api = createFakeApi([{ id: "k1", name: "laptop", key: "sk-live-1", isActive: true }]);
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-chat");
    await settle(root);
    expect(root.renderer.getPaintedText().join("\n")).toContain("openai/gpt-4o");

    const typeInto = async (testId, keys) => {
      const element = root.renderer.findByTestId(testId);
      const bounds = root.renderer.getElementBounds(element.id);
      root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      root.renderer.nativeSimulateKeystrokes(element.id, keys);
      await settle(root);
    };
    await typeInto("chat-system", "b r i e f");
    await typeInto("chat-input", "h e l l o");
    click(root.renderer, "chat-send");
    await settle(root);

    expect(api.streamChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-live-1",
        model: "openai/gpt-4o",
        messages: [
          { role: "system", content: "brief" },
          { role: "user", content: "hello" },
        ],
        signal: expect.anything(),
      })
    );
    expect(api.createChatCompletion).not.toHaveBeenCalled();
    const painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("assistant");
    expect(painted).toContain("reply from openai/gpt-4o");
    expect(painted).toContain("Stream");

    click(root.renderer, "chat-clear");
    await settle(root);
    expect(root.renderer.getPaintedText().join("\n")).toContain("No messages yet.");

    click(root.renderer, "chat-stream");
    await settle(root);
    await typeInto("chat-input", "o n e");
    click(root.renderer, "chat-send");
    await settle(root);
    expect(api.createChatCompletion).toHaveBeenCalledWith({
      apiKey: "sk-live-1",
      model: "openai/gpt-4o",
      messages: [
        { role: "system", content: "brief" },
        { role: "user", content: "one" },
      ],
    });
    expect(api.streamChatCompletion).toHaveBeenCalledTimes(1);
  });

  it("stops a streaming reply and keeps the partial answer", async () => {
    const api = createFakeApi([{ id: "k1", name: "laptop", key: "sk-live-1", isActive: true }]);
    api.streamChatCompletion = vi.fn(
      ({ onDelta, signal }) =>
        new Promise((resolve, reject) => {
          onDelta("partial answer");
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        })
    );
    const root = mount(api);
    await settle(root);
    click(root.renderer, "nav-chat");
    await settle(root);
    const input = root.renderer.findByTestId("chat-input");
    const bounds = root.renderer.getElementBounds(input.id);
    root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    root.renderer.nativeSimulateKeystrokes(input.id, "h i");
    await settle(root);
    click(root.renderer, "chat-send");
    await settle(root);
    expect(root.renderer.getPaintedText().join("\n")).toContain("Streaming...");

    click(root.renderer, "chat-stop");
    await settle(root);
    const painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("partial answer");
    expect(painted).toContain("2 messages");
    expect(painted).not.toContain("Streaming...");
  });

  it("lists media providers by kind and toggles their connections", async () => {
    const api = createFakeApi(
      [],
      [
        { id: "p1", name: "Work", provider: "openai", authType: "apikey", isActive: true },
        { id: "p2", name: "Backup", provider: "openai", authType: "apikey", isActive: true },
      ],
      [{ id: "c9", name: "search-combo", kind: "webSearch", models: [{}, {}, {}] }]
    );
    await api.createProviderNode({
      name: "Local Emb",
      prefix: "le",
      baseUrl: "http://127.0.0.1:9/v1",
      type: "custom-embedding",
    });
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-media-providers");
    await settle(root);
    let painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("Media providers");
    expect(painted).toContain("Text to Image");
    expect(painted).toContain("OpenAI");
    expect(painted).toContain("2 connected");
    expect(painted).toContain("Disable");
    expect(painted).toContain("POST http://127.0.0.1:20129/v1/images/generations");
    expect(painted).toContain("Authorization: Bearer <api-key>");

    click(root.renderer, "media-kind-tts");
    await settle(root);
    expect(root.renderer.getPaintedText().join("\n")).toContain("POST http://127.0.0.1:20129/v1/audio/speech");
    click(root.renderer, "media-kind-image");
    await settle(root);

    click(root.renderer, "media-toggle-openai");
    await settle(root);
    expect(api.updateProvider).toHaveBeenCalledWith("p1", { isActive: false });
    expect(api.updateProvider).toHaveBeenCalledWith("p2", { isActive: false });
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("Disabled");
    expect(painted).toContain("Enable");

    click(root.renderer, "media-kind-embedding");
    await settle(root);
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("Embedding");
    expect(painted).toContain("Local Emb");
    expect(painted).toContain("custom embedding node");
    expect(painted).toContain("No connections");

    click(root.renderer, "media-kind-image");
    await settle(root);
    click(root.renderer, "media-models-openai");
    await settle(root);
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("dall-e-3");
    expect(painted).toContain("DALL-E 3");
    expect(painted).toContain("gpt-image-x (custom)");
    expect(painted).toContain("Disabled");

    click(root.renderer, "media-model-test-openai-dall-e-3");
    await settle(root);
    expect(api.testModel).toHaveBeenCalledWith("openai/dall-e-3", "image");
    expect(root.renderer.getPaintedText().join("\n")).toContain("Test passed");

    click(root.renderer, "media-model-toggle-openai-dall-e-3");
    await settle(root);
    expect(api.enableModel).toHaveBeenCalledWith("openai", "dall-e-3");

    click(root.renderer, "media-kind-webSearch");
    await settle(root);
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("search-combo");
    expect(painted).toContain("3 models");
    click(root.renderer, "media-create-combo");
    await settle(root);
    expect(api.createCombo).toHaveBeenCalledWith("search-combo-1", "webSearch");
  });

  it("lists model cooldowns and clears one", async () => {
    const api = createFakeApi([], [
      { id: "p1", name: "Work", provider: "openai", authType: "apikey", isActive: true },
      { id: "p2", name: "Backup", provider: "anthropic", authType: "apikey", isActive: true },
    ]);
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-providers");
    await settle(root);
    let painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("Model availability");
    expect(painted).toContain("2 model issues");
    expect(painted).toContain("gpt-4o");
    expect(painted).toContain("all models");
    expect(painted).toContain("Backup");

    click(root.renderer, "availability-clear-openai-gpt-4o");
    await settle(root);
    expect(api.clearModelCooldown).toHaveBeenCalledWith("openai", "gpt-4o");
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("1 model issue");
    expect(painted).not.toContain("2 model issues");
  });

  it("edits one model's pricing and resets it", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-pricing");
    await settle(root);
    let painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("anthropic");
    expect(painted).toContain("claude-sonnet");
    expect(painted).toContain("input 3 · output 15");

    click(root.renderer, "pricing-provider-openai");
    await settle(root);
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("gpt-4o");
    expect(painted).toContain("input 2.5 · output 10 · cached 1.25");
    expect(painted).not.toContain("claude-sonnet");

    click(root.renderer, "pricing-edit-gpt-4o");
    await settle(root);
    expect(root.renderer.findByTestId("pricing-input-gpt-4o")).toBeTruthy();
    expect(root.renderer.findByTestId("pricing-cache_creation-gpt-4o")).toBeTruthy();

    click(root.renderer, "pricing-save-gpt-4o");
    await settle(root);
    expect(api.patchPricing).toHaveBeenCalledWith({
      openai: { "gpt-4o": { input: 2.5, output: 10, cached: 1.25 } },
    });

    click(root.renderer, "pricing-reset-gpt-4o");
    await settle(root);
    expect(api.resetPricing).toHaveBeenLastCalledWith("openai", "gpt-4o");

    click(root.renderer, "pricing-reset-all");
    await settle(root);
    expect(api.resetPricing).toHaveBeenCalledTimes(1);
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("Confirm reset all");

    click(root.renderer, "pricing-reset-all");
    await settle(root);
    expect(api.resetPricing).toHaveBeenCalledTimes(2);
    expect(api.resetPricing).toHaveBeenLastCalledWith();
  });

  it("tests provider connections and shows the result", async () => {
    const api = createFakeApi([], [
      { id: "p1", name: "Good", provider: "openai", authType: "apikey", isActive: true },
      { id: "p2", name: "Bad", provider: "openai", authType: "apikey", isActive: true },
    ]);
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-providers");
    await settle(root);
    click(root.renderer, "provider-test-p1");
    await settle(root);
    expect(api.testProvider).toHaveBeenCalledWith("p1");
    expect(root.renderer.getPaintedText().join("\n")).toContain("Test passed");

    click(root.renderer, "provider-test-p2");
    await settle(root);
    expect(api.testProvider).toHaveBeenLastCalledWith("p2");
    expect(root.renderer.getPaintedText().join("\n")).toContain("Test failed: invalid key");
  });

  it("adds an API-key provider connection and deletes it", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-providers");
    await settle(root);
    const typeInto = async (testId, keys) => {
      const element = root.renderer.findByTestId(testId);
      const bounds = root.renderer.getElementBounds(element.id);
      root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      root.renderer.nativeSimulateKeystrokes(element.id, keys);
      await settle(root);
    };
    await typeInto("provider-id-input", "o p e n a i");
    await typeInto("provider-key-input", "s k - t e s t");
    click(root.renderer, "provider-validate");
    await settle(root);
    expect(api.validateProvider).toHaveBeenCalledWith("openai", "sk-test");
    expect(root.renderer.getPaintedText().join("\n")).toContain("Key valid");

    click(root.renderer, "provider-create");
    await settle(root);

    expect(api.createProvider).toHaveBeenCalledWith({ provider: "openai", apiKey: "sk-test", name: undefined });
    let painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("openai");

    click(root.renderer, "provider-delete-p1");
    await settle(root);
    expect(api.deleteProvider).toHaveBeenCalledWith("p1");
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("No provider connections yet.");

    await typeInto("provider-id-input", "o l l a m a - l o c a l");
    click(root.renderer, "provider-create");
    await settle(root);
    expect(api.createProvider).toHaveBeenLastCalledWith({ provider: "ollama-local", apiKey: "", name: undefined });
  });

  it("shows usage totals and switches the period", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-usage");
    await settle(root);
    let painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("42");
    expect(painted).toContain("1200");
    expect(painted).toContain("$0.1234");
    expect(painted).toContain("gpt-4o");
    expect(painted).toContain("openai");
    expect(painted).toContain("Tokens by bucket");
    expect(painted).toContain("120 tok");
    expect(api.getUsageStats).toHaveBeenCalledWith("7d");
    expect(api.getUsageChart).toHaveBeenCalledWith("7d");

    click(root.renderer, "usage-period-24h");
    await settle(root);
    expect(api.getUsageStats).toHaveBeenLastCalledWith("24h");
    expect(api.getUsageChart).toHaveBeenLastCalledWith("24h");
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("7");
  });

  it("lists routed models and toggles, enables all and deletes a custom model", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-models");
    await settle(root);
    const painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("openai · 3");
    expect(painted).toContain("anthropic · 1");
    expect(painted).toContain("gpt-4o-mini");
    expect(painted).toContain("Disabled");
    expect(painted).toContain("custom");
    expect(api.getModels).toHaveBeenCalled();
    expect(api.getDisabledModels).toHaveBeenCalled();

    click(root.renderer, "model-toggle-openai/gpt-4o-mini");
    await settle(root);
    expect(api.enableModel).toHaveBeenCalledWith("openai", "gpt-4o-mini");

    click(root.renderer, "model-toggle-anthropic/claude-sonnet");
    await settle(root);
    expect(api.disableModels).toHaveBeenCalledWith("anthropic", ["claude-sonnet"]);

    click(root.renderer, "model-enable-all-openai");
    await settle(root);
    expect(api.enableAllModels).toHaveBeenCalledWith("openai");

    click(root.renderer, "model-delete-openai/my-model");
    await settle(root);
    expect(api.deleteCustomModel).toHaveBeenCalledWith("openai", "my-model");

    expect(painted).toContain("Custom media models (1)");
    expect(painted).toContain("gpt-image-x");
    click(root.renderer, "custom-media-delete-gpt-image-x");
    await settle(root);
    expect(api.deleteCustomModel).toHaveBeenLastCalledWith("openai", "gpt-image-x", "image");

    click(root.renderer, "custom-model-kind-image");
    await settle(root);
    const kindInput = async (testId, keys) => {
      const element = root.renderer.findByTestId(testId);
      const bounds = root.renderer.getElementBounds(element.id);
      root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      root.renderer.nativeSimulateKeystrokes(element.id, keys);
      await settle(root);
    };
    await kindInput("custom-model-alias-input", "i m g x");
    await kindInput("custom-model-id-input", "f l u x - a");
    click(root.renderer, "custom-model-add");
    await settle(root);
    expect(api.addCustomModel).toHaveBeenCalledWith({ providerAlias: "imgx", id: "flux-a", type: "image" });

    click(root.renderer, "model-test-openai/gpt-4o");
    await settle(root);
    expect(api.testModel).toHaveBeenCalledWith("openai/gpt-4o");
    expect(root.renderer.getPaintedText().join("\n")).toContain("Test passed");

    click(root.renderer, "model-test-openai/gpt-4o-mini");
    await settle(root);
    expect(api.testModel).toHaveBeenLastCalledWith("openai/gpt-4o-mini");
    expect(root.renderer.getPaintedText().join("\n")).toContain("Test failed: unreachable");

    click(root.renderer, "model-alias-anthropic/claude-sonnet");
    await settle(root);
    expect(root.renderer.findByTestId("model-alias-input-anthropic/claude-sonnet")).toBeTruthy();
  });

  it("lists, creates and deletes combos", async () => {
    const api = createFakeApi([], [], [{ id: "c0", name: "fast-first", kind: null, models: [{}, {}] }]);
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-combos");
    await settle(root);
    let painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("fast-first");
    expect(painted).toContain("2 models");

    const input = root.renderer.findByTestId("combo-name-input");
    const bounds = root.renderer.getElementBounds(input.id);
    root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    root.renderer.nativeSimulateKeystrokes(input.id, "c h e a p");
    await settle(root);
    click(root.renderer, "combo-create");
    await settle(root);
    expect(api.createCombo).toHaveBeenCalledWith("cheap");
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("cheap");

    click(root.renderer, "combo-delete-c0");
    await settle(root);
    expect(api.deleteCombo).toHaveBeenCalledWith("c0");
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).not.toContain("fast-first");
  });

  it("edits a combo's ordered models", async () => {
    const api = createFakeApi([], [], [{ id: "c1", name: "mix", kind: null, models: ["openai/gpt-4o"] }]);
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-combos");
    await settle(root);
    click(root.renderer, "combo-edit-c1");
    await settle(root);

    const input = root.renderer.findByTestId("combo-model-add-input-c1");
    const bounds = root.renderer.getElementBounds(input.id);
    root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    root.renderer.nativeSimulateKeystrokes(input.id, "a n t h r o p i c / c l a u d e");
    await settle(root);
    click(root.renderer, "combo-model-add-c1");
    await settle(root);

    click(root.renderer, "combo-model-up-c1-1");
    await settle(root);
    click(root.renderer, "combo-save-c1");
    await settle(root);

    expect(api.updateCombo).toHaveBeenCalledWith("c1", {
      name: "mix",
      models: ["anthropic/claude", "openai/gpt-4o"],
    });
    expect(root.renderer.getPaintedText().join("\n")).toContain("2 models");
  });

  it("sets a combo strategy and its fusion judge", async () => {
    const api = createFakeApi([], [], [{ id: "c1", name: "mix", kind: null, models: ["openai/gpt-4o"] }]);
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-combos");
    await settle(root);
    click(root.renderer, "combo-edit-c1");
    await settle(root);

    click(root.renderer, "combo-strategy-c1-round-robin");
    await settle(root);
    expect(api.patchSettings).toHaveBeenLastCalledWith({
      comboStrategies: { mix: { fallbackStrategy: "round-robin" } },
    });
    expect(root.renderer.getPaintedText().join("\n")).toContain("1 model · round-robin");

    click(root.renderer, "combo-strategy-c1-fusion");
    await settle(root);
    expect(api.patchSettings).toHaveBeenLastCalledWith({
      comboStrategies: { mix: { fallbackStrategy: "fusion" } },
    });

    const judge = root.renderer.findByTestId("combo-judge-c1");
    expect(judge).toBeTruthy();
    const bounds = root.renderer.getElementBounds(judge.id);
    root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    root.renderer.nativeSimulateKeystrokes(judge.id, "j u d g e");
    await settle(root);
    click(root.renderer, "combo-judge-save-c1");
    await settle(root);
    expect(api.patchSettings).toHaveBeenLastCalledWith({
      comboStrategies: { mix: { fallbackStrategy: "fusion", judgeModel: "judge" } },
    });

    click(root.renderer, "combo-strategy-c1-fallback");
    await settle(root);
    expect(api.patchSettings).toHaveBeenLastCalledWith({ comboStrategies: {} });
  });

  it("previews and creates combo presets", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-combos");
    await settle(root);
    click(root.renderer, "combo-presets-claude");
    await settle(root);
    expect(api.getComboPresets).toHaveBeenCalledWith("claude");
    let painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("claude · 1 to create · 1 existing");
    expect(painted).toContain("claude-fast");
    expect(painted).toContain("claude-old · exists");

    click(root.renderer, "combo-presets-create");
    await settle(root);
    expect(api.createComboPresets).toHaveBeenCalledWith("claude");
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).not.toContain("to create");
  });

  it("edits the capacity adapter fallbacks", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-combos");
    await settle(root);

    const input = root.renderer.findByTestId("cap-vision-input");
    const bounds = root.renderer.getElementBounds(input.id);
    root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    root.renderer.nativeSimulateKeystrokes(input.id, "o p e n a i / g p t - 4 o");
    await settle(root);
    click(root.renderer, "cap-vision-add");
    await settle(root);
    expect(api.patchSettings).toHaveBeenLastCalledWith({
      capacityAdapter: expect.objectContaining({
        vision: { enabled: true, roundRobin: false, models: ["openai/gpt-4o"] },
      }),
    });

    click(root.renderer, "cap-vision-enabled");
    await settle(root);
    expect(api.patchSettings).toHaveBeenLastCalledWith({
      capacityAdapter: expect.objectContaining({
        vision: { enabled: false, roundRobin: false, models: ["openai/gpt-4o"] },
      }),
    });

    click(root.renderer, "cap-vision-remove-0");
    await settle(root);
    expect(api.patchSettings).toHaveBeenLastCalledWith({
      capacityAdapter: expect.objectContaining({
        vision: { enabled: false, roundRobin: false, models: [] },
      }),
    });
  });

  it("shows console log lines and clears them", async () => {
    const api = createFakeApi();
    api.getConsoleLogs
      .mockResolvedValueOnce(["[INFO] gateway booted", "[ERROR] upstream refused"])
      .mockResolvedValue([]);
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-console-log");
    await settle(root);
    let painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("[INFO] gateway booted");
    expect(painted).toContain("[ERROR] upstream refused");

    click(root.renderer, "console-clear");
    await settle(root);
    expect(api.clearConsoleLogs).toHaveBeenCalledOnce();
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).not.toContain("upstream refused");
  });

  it("shows saver savings and patches the switches", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-token-saver");
    await settle(root);
    let painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("RTK saved 1200 bytes across 3 requests");
    expect(painted).toContain("Caveman on 5 requests, off 1");
    expect(painted).toContain("Enabled");

    click(root.renderer, "saver-caveman-toggle");
    await settle(root);
    expect(api.patchSettings).toHaveBeenCalledWith({ cavemanEnabled: true });

    click(root.renderer, "saver-level-ultra");
    await settle(root);
    expect(api.patchSettings).toHaveBeenLastCalledWith({ cavemanLevel: "ultra" });

    click(root.renderer, "saver-rtk-toggle");
    await settle(root);
    expect(api.patchSettings).toHaveBeenLastCalledWith({ rtkEnabled: false });
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("Disabled");
    expect(painted).toContain("Installed: yes · running: no");
    expect(painted).toContain("Version: 0.9.1");
    expect(painted).toContain("URL: http://127.0.0.1:5757");
  });

  it("lists proxy pools, toggles and deletes one", async () => {
    const api = createFakeApi([], [], [], [
      { id: "pp1", name: "home", proxyUrl: "http://10.0.0.2:8080", type: "http", isActive: true, boundConnectionCount: 2 },
    ]);
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-proxy-pools");
    await settle(root);
    let painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("home");
    expect(painted).toContain("http://10.0.0.2:8080");
    expect(painted).toContain("2 bound");

    click(root.renderer, "pool-toggle-pp1");
    await settle(root);
    expect(api.updateProxyPool).toHaveBeenCalledWith("pp1", { isActive: false });
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("Disabled");

    click(root.renderer, "pool-delete-pp1");
    await settle(root);
    expect(api.deleteProxyPool).toHaveBeenCalledWith("pp1");
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("No proxy pools yet.");
  });

  it("tests, edits and toggles strict mode on a proxy pool", async () => {
    const api = createFakeApi([], [], [], [
      { id: "pp1", name: "home", proxyUrl: "http://10.0.0.2:8080", type: "http", isActive: true },
    ]);
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-proxy-pools");
    await settle(root);

    click(root.renderer, "pool-test-pp1");
    await settle(root);
    expect(api.testProxyPool).toHaveBeenCalledWith("pp1");
    expect(root.renderer.getPaintedText().join("\n")).toContain("OK 200 42ms");

    click(root.renderer, "pool-edit-pp1");
    await settle(root);
    expect(root.renderer.findByTestId("pool-url-edit-pp1")).toBeTruthy();

    click(root.renderer, "pool-strict-pp1");
    await settle(root);
    expect(api.updateProxyPool).toHaveBeenLastCalledWith("pp1", { strictProxy: true });

    click(root.renderer, "pool-save-pp1");
    await settle(root);
    expect(api.updateProxyPool).toHaveBeenLastCalledWith("pp1", {
      name: "home",
      proxyUrl: "http://10.0.0.2:8080",
    });
  });

  it("keeps CLI tools disabled in the sidebar", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);
    const painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("CLI Tools");
    click(root.renderer, "nav-cli-tools");
    await settle(root);
    expect(root.renderer.getPaintedText().join("\n")).toContain("Endpoint & Key");
  });

  it("creates and deletes a custom provider node", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-providers");
    await settle(root);
    click(root.renderer, "nodes-open");
    await settle(root);
    expect(root.renderer.getPaintedText().join("\n")).toContain("No custom nodes yet.");

    const typeInto = async (testId, keys) => {
      const element = root.renderer.findByTestId(testId);
      const bounds = root.renderer.getElementBounds(element.id);
      root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      root.renderer.nativeSimulateKeystrokes(element.id, keys);
      await settle(root);
    };
    await typeInto("node-name-input", "L o c a l");
    await typeInto("node-prefix-input", "l o c");
    await typeInto("node-url-input", "h t t p : / / 1 2 7 . 0 . 0 . 1 : 8 0 8 0 / v 1");
    click(root.renderer, "node-create");
    await settle(root);

    expect(api.createProviderNode).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Local",
        prefix: "loc",
        baseUrl: "http://127.0.0.1:8080/v1",
        type: "openai-compatible",
        apiType: "chat",
      })
    );
    const painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("Local");
    expect(painted).toContain("loc · http://127.0.0.1:8080/v1");

    click(root.renderer, "node-edit-openai-compatible-chat-1");
    await settle(root);
    expect(root.renderer.findByTestId("node-prefix-edit-openai-compatible-chat-1")).toBeTruthy();
    click(root.renderer, "node-save-openai-compatible-chat-1");
    await settle(root);
    expect(api.updateProviderNode).toHaveBeenCalledWith("openai-compatible-chat-1", {
      name: "Local",
      prefix: "loc",
      baseUrl: "http://127.0.0.1:8080/v1",
      apiType: "chat",
    });

    click(root.renderer, "node-delete-openai-compatible-chat-1");
    await settle(root);
    expect(api.deleteProviderNode).toHaveBeenCalledWith("openai-compatible-chat-1");
    expect(root.renderer.getPaintedText().join("\n")).toContain("No custom nodes yet.");
  });

  it("creates anthropic-compatible and embedding nodes", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-providers");
    await settle(root);
    click(root.renderer, "nodes-open");
    await settle(root);

    const typeInto = async (testId, keys) => {
      const element = root.renderer.findByTestId(testId);
      const bounds = root.renderer.getElementBounds(element.id);
      root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      root.renderer.nativeSimulateKeystrokes(element.id, keys);
      await settle(root);
    };

    click(root.renderer, "node-type-anthropic-compatible");
    await settle(root);
    await typeInto("node-name-input", "C l a u d e");
    await typeInto("node-prefix-input", "c c");
    await typeInto("node-url-input", "h t t p s : / / p r o x y . t e s t / v 1");
    click(root.renderer, "node-create");
    await settle(root);
    expect(api.createProviderNode).toHaveBeenLastCalledWith({
      name: "Claude",
      prefix: "cc",
      baseUrl: "https://proxy.test/v1",
      type: "anthropic-compatible",
    });

    click(root.renderer, "node-type-custom-embedding");
    await settle(root);
    await typeInto("node-name-input", "E m b");
    await typeInto("node-prefix-input", "e m b");
    await typeInto("node-url-input", "h t t p s : / / e m b . t e s t / v 1");
    click(root.renderer, "node-create");
    await settle(root);
    expect(api.createProviderNode).toHaveBeenLastCalledWith({
      name: "Emb",
      prefix: "emb",
      baseUrl: "https://emb.test/v1",
      type: "custom-embedding",
    });
  });

  it("shows the agent skills list with raw URLs", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-skills");
    await settle(root);
    const painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("Agent skills");
    expect(painted).toContain("9Router (Entry)");
    expect(painted).toContain("/v1/chat/completions");
    expect(painted).toContain("/skills/9router-web-fetch/SKILL.md");
  });

  it("shows profile settings and patches the safe toggles", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-profile");
    await settle(root);
    let painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("Profile & settings");
    expect(painted).toContain("Require dashboard login");
    expect(painted).toContain("Password is set.");

    click(root.renderer, "profile-require-login");
    await settle(root);
    expect(api.patchSettings).toHaveBeenCalledWith({ requireLogin: false });

    click(root.renderer, "profile-tunnel-access");
    await settle(root);
    expect(api.patchSettings).toHaveBeenLastCalledWith({ tunnelDashboardAccess: true });
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("Enabled");
  });

  it("saves and tests the outbound proxy", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-profile");
    await settle(root);

    const input = root.renderer.findByTestId("profile-proxy-url");
    expect(input).toBeTruthy();
    const bounds = root.renderer.getElementBounds(input.id);
    root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    root.renderer.nativeSimulateKeystrokes(input.id, "h t t p : / / 1 2 7 . 0 . 0 . 1 : 9");
    await settle(root);

    click(root.renderer, "profile-proxy-enable");
    await settle(root);
    click(root.renderer, "profile-proxy-save");
    await settle(root);
    expect(api.patchSettings).toHaveBeenLastCalledWith({
      outboundProxyEnabled: true,
      outboundProxyUrl: "http://127.0.0.1:9",
      outboundNoProxy: "",
    });
    expect(root.renderer.getPaintedText().join("\n")).toContain("Outbound proxy saved.");

    click(root.renderer, "profile-proxy-test");
    await settle(root);
    expect(api.testProxyUrl).toHaveBeenCalledWith("http://127.0.0.1:9");
    expect(root.renderer.getPaintedText().join("\n")).toContain("Proxy OK 200 12ms");
  });

  it("changes the dashboard password and rejects a mismatch", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-profile");
    await settle(root);

    const type = async (testId, keys) => {
      const input = root.renderer.findByTestId(testId);
      expect(input).toBeTruthy();
      const bounds = root.renderer.getElementBounds(input.id);
      root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      root.renderer.nativeSimulateKeystrokes(input.id, keys);
      await settle(root);
    };

    await type("profile-current-password", "o l d");
    await type("profile-new-password", "s e c r e t");
    await type("profile-confirm-password", "s e c r e t");
    click(root.renderer, "profile-change-password");
    await settle(root);
    expect(api.patchSettings).toHaveBeenLastCalledWith({ newPassword: "secret", currentPassword: "old" });
    expect(root.renderer.getPaintedText().join("\n")).toContain("Password updated.");

    await type("profile-new-password", "x");
    await type("profile-confirm-password", "y");
    click(root.renderer, "profile-change-password");
    await settle(root);
    expect(root.renderer.getPaintedText().join("\n")).toContain("New passwords do not match.");
    expect(api.patchSettings).toHaveBeenCalledTimes(1);
  });

  it("loads translator step files read-only", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-translator");
    await settle(root);
    let painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("1_req_client.json");
    expect(api.getTranslatorFile).toHaveBeenCalledWith("1_req_client.json");
    expect(painted).toContain("marker");

    click(root.renderer, "translator-step-5");
    await settle(root);
    expect(api.getTranslatorFile).toHaveBeenLastCalledWith("5_res_provider.txt");
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("5_res_provider.txt");
  });

  it("pages through the request log", async () => {
    const api = createFakeApi();
    const root = mount(api);
    await settle(root);

    click(root.renderer, "nav-request-log");
    await settle(root);
    let painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("gpt-4o");
    expect(painted).toContain("page 1 / 2");
    expect(api.getRequestDetails).toHaveBeenCalledWith(1, 20, { provider: "", model: "", status: "", startDate: "", endDate: "" });

    click(root.renderer, "request-log-next");
    await settle(root);
    expect(api.getRequestDetails).toHaveBeenLastCalledWith(2, 20, { provider: "", model: "", status: "", startDate: "", endDate: "" });
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("claude-sonnet");
    expect(painted).toContain("page 2 / 2");

    click(root.renderer, "request-log-prev");
    await settle(root);
    expect(api.getRequestDetails).toHaveBeenLastCalledWith(1, 20, { provider: "", model: "", status: "", startDate: "", endDate: "" });

    const input = root.renderer.findByTestId("request-log-provider");
    const bounds = root.renderer.getElementBounds(input.id);
    root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    root.renderer.nativeSimulateKeystrokes(input.id, "o p e n a i");
    await settle(root);
    click(root.renderer, "request-log-apply");
    await settle(root);
    expect(api.getRequestDetails).toHaveBeenLastCalledWith(1, 20, {
      provider: "openai",
      model: "",
      status: "",
      startDate: "",
      endDate: "",
    });

    const startInput = root.renderer.findByTestId("request-log-start");
    const startBounds = root.renderer.getElementBounds(startInput.id);
    root.renderer.nativeSimulateClick(startBounds.x + startBounds.width / 2, startBounds.y + startBounds.height / 2);
    root.renderer.nativeSimulateKeystrokes(startInput.id, "2 0 2 6 - 1 1 - 0 1");
    const endInput = root.renderer.findByTestId("request-log-end");
    const endBounds = root.renderer.getElementBounds(endInput.id);
    root.renderer.nativeSimulateClick(endBounds.x + endBounds.width / 2, endBounds.y + endBounds.height / 2);
    root.renderer.nativeSimulateKeystrokes(endInput.id, "2 0 2 6 - 1 1 - 3 0");
    await settle(root);
    click(root.renderer, "request-log-apply");
    await settle(root);
    expect(api.getRequestDetails).toHaveBeenLastCalledWith(1, 20, {
      provider: "openai",
      model: "",
      status: "",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
    });

    click(root.renderer, "request-log-clear");
    await settle(root);
    expect(api.getRequestDetails).toHaveBeenLastCalledWith(1, 20, { provider: "", model: "", status: "", startDate: "", endDate: "" });
  });
});
