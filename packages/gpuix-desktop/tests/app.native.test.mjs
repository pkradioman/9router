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

function createFakeApi(initial = [], providerSeed = []) {
  let keys = initial.map((item) => ({ ...item }));
  let providers = providerSeed.map((item) => ({ ...item }));
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
});
