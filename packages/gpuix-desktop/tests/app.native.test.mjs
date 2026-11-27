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
  let fakeSettings = { cavemanEnabled: false, cavemanLevel: "full", rtkEnabled: true };
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
    listCombos: vi.fn(async () => combos.map((item) => ({ ...item }))),
    createCombo: vi.fn(async (name) => {
      const created = { id: `c${combos.length + 1}`, name, kind: null, models: [] };
      combos = [created, ...combos];
      return created;
    }),
    deleteCombo: vi.fn(async (id) => {
      combos = combos.filter((item) => item.id !== id);
      return { success: true };
    }),
    getConsoleLogs: vi.fn(async () => ["[INFO] gateway booted", "[ERROR] upstream refused"]),
    clearConsoleLogs: vi.fn(async () => ({ success: true })),
    getSettings: vi.fn(async () => ({ ...fakeSettings })),
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
    expect(api.getUsageStats).toHaveBeenCalledWith("7d");

    click(root.renderer, "usage-period-24h");
    await settle(root);
    expect(api.getUsageStats).toHaveBeenLastCalledWith("24h");
    painted = root.renderer.getPaintedText().join("\n");
    expect(painted).toContain("7");
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
});
