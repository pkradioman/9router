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

function createFakeApi(initial = [], providerSeed = [], comboSeed = [], poolSeed = []) {
  let keys = initial.map((item) => ({ ...item }));
  let providers = providerSeed.map((item) => ({ ...item }));
  let combos = comboSeed.map((item) => ({ ...item }));
  let pools = poolSeed.map((item) => ({ ...item }));
  let nodes = [];
  let fakeSettings = {
    cavemanEnabled: false,
    cavemanLevel: "full",
    rtkEnabled: true,
    requireLogin: true,
    requireApiKey: true,
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
    getDisabledModels: vi.fn(async () => ({ openai: ["gpt-4o-mini"] })),
    disableModels: vi.fn(async () => ({ success: true })),
    enableModel: vi.fn(async () => ({ success: true })),
    enableAllModels: vi.fn(async () => ({ success: true })),
    listCustomModels: vi.fn(async () => [{ providerAlias: "openai", id: "my-model", kind: "llm" }]),
    addCustomModel: vi.fn(async () => ({ success: true })),
    deleteCustomModel: vi.fn(async () => ({ success: true })),
    setModelAlias: vi.fn(async () => ({ success: true })),
    deleteModelAlias: vi.fn(async () => ({ success: true })),
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
    createCombo: vi.fn(async (name) => {
      const created = { id: `c${combos.length + 1}`, name, kind: null, models: [] };
      combos = [created, ...combos];
      return created;
    }),
    updateCombo: vi.fn(async (id, patch) => {
      combos = combos.map((item) => (item.id === id ? { ...item, ...patch } : item));
      return { combo: combos.find((item) => item.id === id) };
    }),
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
    getTokenSaverStats: vi.fn(async () => ({
      rtk: { hitRequests: 3, bytesSaved: 1200 },
      caveman: { onRequests: 5, offRequests: 1 },
    })),
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
    getCliToolStatuses: vi.fn(async () => ({
      claude: { installed: true, has9Router: true },
      codex: { installed: true, has9Router: false },
      droid: { installed: false },
      hermes: null,
    })),
    getTranslatorFile: vi.fn(async (file) => `{"file":"${file}","marker":"body"}`),
    listProviderNodes: vi.fn(async () => nodes.map((node) => ({ ...node }))),
    createProviderNode: vi.fn(async (body) => {
      const created = { id: `openai-compatible-chat-${nodes.length + 1}`, apiType: "chat", ...body };
      nodes = [created, ...nodes];
      return { node: created };
    }),
    deleteProviderNode: vi.fn(async (id) => {
      nodes = nodes.filter((node) => node.id !== id);
      return { success: true };
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
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
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
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
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
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
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
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
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
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
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
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
    await settle(root);

    expect(root.renderer.getPaintedText().join("\n")).toContain("Unauthorized");
  });

  it("switches to the gateway status page from the sidebar", async () => {
    const api = createFakeApi();
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
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
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
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

  it("edits a provider connection's name, model and priority", async () => {
    const api = createFakeApi([], [
      { id: "p1", name: "Work", provider: "openai", authType: "apikey", isActive: true, defaultModel: "gpt-4o", priority: 1 },
    ]);
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
    await settle(root);

    click(root.renderer, "nav-providers");
    await settle(root);
    expect(root.renderer.getPaintedText().join("\n")).toContain("gpt-4o");

    click(root.renderer, "provider-edit-p1");
    await settle(root);
    expect(root.renderer.findByTestId("provider-name-edit-p1")).toBeTruthy();
    expect(root.renderer.findByTestId("provider-model-edit-p1")).toBeTruthy();
    expect(root.renderer.findByTestId("provider-priority-edit-p1")).toBeTruthy();

    click(root.renderer, "provider-save-p1");
    await settle(root);
    expect(api.updateProvider).toHaveBeenCalledWith("p1", { name: "Work", defaultModel: "gpt-4o", priority: 1 });
  });

  it("tests provider connections and shows the result", async () => {
    const api = createFakeApi([], [
      { id: "p1", name: "Good", provider: "openai", authType: "apikey", isActive: true },
      { id: "p2", name: "Bad", provider: "openai", authType: "apikey", isActive: true },
    ]);
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
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
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
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
  });

  it("shows usage totals and switches the period", async () => {
    const api = createFakeApi();
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
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
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
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

    click(root.renderer, "model-alias-anthropic/claude-sonnet");
    await settle(root);
    expect(root.renderer.findByTestId("model-alias-input-anthropic/claude-sonnet")).toBeTruthy();
  });

  it("lists, creates and deletes combos", async () => {
    const api = createFakeApi([], [], [{ id: "c0", name: "fast-first", kind: null, models: [{}, {}] }]);
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
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
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
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

  it("shows console log lines and clears them", async () => {
    const api = createFakeApi();
    api.getConsoleLogs
      .mockResolvedValueOnce(["[INFO] gateway booted", "[ERROR] upstream refused"])
      .mockResolvedValue([]);
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
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
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
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
  });

  it("lists proxy pools, toggles and deletes one", async () => {
    const api = createFakeApi([], [], [], [
      { id: "pp1", name: "home", proxyUrl: "http://10.0.0.2:8080", type: "http", isActive: true },
    ]);
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
    await settle(root);

    click(root.renderer, "nav-proxy-pools");
    await settle(root);
    let painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("home");
    expect(painted).toContain("http://10.0.0.2:8080");

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

  it("shows CLI tool connection status", async () => {
    const api = createFakeApi();
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
    await settle(root);

    click(root.renderer, "nav-cli-tools");
    await settle(root);
    const painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("Claude Code");
    expect(painted).toContain("Connected to 9Router");
    expect(painted).toContain("Codex");
    expect(painted).toContain("Installed, not connected");
    expect(painted).toContain("Droid");
    expect(painted).toContain("Not installed");
    expect(painted).toContain("Unavailable");
  });

  it("creates and deletes a custom provider node", async () => {
    const api = createFakeApi();
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
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
      expect.objectContaining({ name: "Local", prefix: "loc", baseUrl: "http://127.0.0.1:8080/v1", apiType: "chat" })
    );
    const painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("Local");
    expect(painted).toContain("loc · http://127.0.0.1:8080/v1");

    click(root.renderer, "node-delete-openai-compatible-chat-1");
    await settle(root);
    expect(api.deleteProviderNode).toHaveBeenCalledWith("openai-compatible-chat-1");
    expect(root.renderer.getPaintedText().join("\n")).toContain("No custom nodes yet.");
  });

  it("shows the agent skills list with raw URLs", async () => {
    const api = createFakeApi();
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
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
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
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

  it("loads translator step files read-only", async () => {
    const api = createFakeApi();
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
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
    const root = createTestRoot({ width: 1080, height: 720 });
    root.render(h(App, { api, status: status(), onRefresh: () => {} }));
    await settle(root);

    click(root.renderer, "nav-request-log");
    await settle(root);
    let painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("gpt-4o");
    expect(painted).toContain("page 1 / 2");
    expect(api.getRequestDetails).toHaveBeenCalledWith(1, 20);

    click(root.renderer, "request-log-next");
    await settle(root);
    expect(api.getRequestDetails).toHaveBeenLastCalledWith(2, 20);
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("claude-sonnet");
    expect(painted).toContain("page 2 / 2");

    click(root.renderer, "request-log-prev");
    await settle(root);
    expect(api.getRequestDetails).toHaveBeenLastCalledWith(1, 20);
  });
});
