import { describe, expect, it } from "vitest";
import { ApiError, createGatewayApi } from "../src/ui/api.mjs";

function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, fetchImpl };
}

function json(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

describe("createGatewayApi", () => {
  it("sends the CLI token and returns the key list", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ keys: [{ id: "k1", name: "laptop", key: "sk-1" }] }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", token: "tok", fetchImpl });

    const keys = await api.listKeys();
    expect(keys).toEqual([{ id: "k1", name: "laptop", key: "sk-1" }]);
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/keys");
    expect(calls[0].init.headers["x-9r-cli-token"]).toBe("tok");
  });

  it("creates, updates and deletes keys with JSON bodies", async () => {
    const { calls, fetchImpl } = fakeFetch((url, init) => {
      if (init.method === "POST") return json({ key: "sk-new", name: "desk" }, 201);
      return json({ key: { id: "k1", isActive: false } });
    });
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    await api.createKey("desk");
    await api.updateKey("k 1", { isActive: false });
    await api.deleteKey("k 1");

    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe('{"name":"desk"}');
    expect(calls[0].init.headers["content-type"]).toBe("application/json");
    expect(calls[1].url).toBe("http://127.0.0.1:20129/api/keys/k%201");
    expect(calls[1].init.body).toBe('{"isActive":false}');
    expect(calls[2].init.method).toBe("DELETE");
    expect(calls[0].init.headers["x-9r-cli-token"]).toBeUndefined();
  });

  it("lists and updates provider connections", async () => {
    const { calls, fetchImpl } = fakeFetch((url, init) =>
      init.method === "PUT"
        ? json({ provider: { id: "p1", isActive: false } })
        : json({ connections: [{ id: "p1", name: "Work", isActive: true }] })
    );
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", token: "tok", fetchImpl });

    expect(await api.listProviders()).toEqual([{ id: "p1", name: "Work", isActive: true }]);
    await api.updateProvider("p1", { isActive: false });
    expect(calls[1].url).toBe("http://127.0.0.1:20129/api/providers/p1");
    expect(calls[1].init.body).toBe('{"isActive":false}');
    expect(calls[1].init.headers["x-9r-cli-token"]).toBe("tok");
  });

  it("requests usage stats for the selected period", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ totalRequests: 3 }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    expect(await api.getUsageStats("7d")).toEqual({ totalRequests: 3 });
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/usage/stats?period=7d");
  });

  it("lists, creates and deletes combos", async () => {
    const { calls, fetchImpl } = fakeFetch((url, init) =>
      init.method === "DELETE"
        ? json({ success: true })
        : init.method === "POST"
          ? json({ id: "c1", name: "fast" }, 201)
          : json({ combos: [{ id: "c0", name: "old", models: [] }] })
    );
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    expect(await api.listCombos()).toEqual([{ id: "c0", name: "old", models: [] }]);
    await api.createCombo("fast");
    await api.deleteCombo("c 1");
    expect(calls[1].init.body).toBe('{"name":"fast"}');
    expect(calls[2].url).toBe("http://127.0.0.1:20129/api/combos/c%201");
    expect(calls[2].init.method).toBe("DELETE");
  });

  it("fetches and clears console logs", async () => {
    const { calls, fetchImpl } = fakeFetch((url, init) =>
      init.method === "DELETE" ? json({ success: true }) : json({ success: true, logs: ["[INFO] a"] })
    );
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    expect(await api.getConsoleLogs()).toEqual(["[INFO] a"]);
    await api.clearConsoleLogs();
    expect(calls[1].url).toBe("http://127.0.0.1:20129/api/translator/console-logs");
    expect(calls[1].init.method).toBe("DELETE");
  });

  it("reads and patches settings and fetches saver stats", async () => {
    const { calls, fetchImpl } = fakeFetch((url, init) =>
      init.method === "PATCH" ? json({ cavemanEnabled: true }) : json({ totalRequests: 1 })
    );
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    await api.getSettings();
    await api.patchSettings({ cavemanEnabled: true });
    await api.getTokenSaverStats("30d");
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/settings");
    expect(calls[1].init.method).toBe("PATCH");
    expect(calls[1].init.body).toBe('{"cavemanEnabled":true}');
    expect(calls[2].url).toBe("http://127.0.0.1:20129/api/token-saver/stats?period=30d");
  });

  it("manages proxy pools", async () => {
    const { calls, fetchImpl } = fakeFetch((url, init) => {
      if (init.method === "POST") return json({ proxyPool: { id: "p1" } }, 201);
      if (init.method === "PUT") return json({ proxyPool: { id: "p1", isActive: false } });
      if (init.method === "DELETE") return json({ success: true });
      return json({ proxyPools: [{ id: "p1", name: "home" }] });
    });
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    expect(await api.listProxyPools()).toEqual([{ id: "p1", name: "home" }]);
    await api.createProxyPool({ name: "home", proxyUrl: "http://p:1", type: "http" });
    await api.updateProxyPool("p1", { isActive: false });
    await api.deleteProxyPool("p1");
    expect(calls[1].url).toBe("http://127.0.0.1:20129/api/proxy-pools");
    expect(calls[1].init.method).toBe("POST");
    expect(calls[2].url).toBe("http://127.0.0.1:20129/api/proxy-pools/p1");
    expect(calls[3].init.method).toBe("DELETE");
  });

  it("creates and deletes provider connections", async () => {
    const { calls, fetchImpl } = fakeFetch((url, init) =>
      init.method === "DELETE" ? json({ success: true }) : json({ provider: { id: "p1" } }, 201)
    );
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    await api.createProvider({ provider: "openai", apiKey: "sk-test" });
    await api.deleteProvider("p1");
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/providers");
    expect(calls[0].init.body).toBe('{"provider":"openai","apiKey":"sk-test"}');
    expect(calls[1].url).toBe("http://127.0.0.1:20129/api/providers/p1");
    expect(calls[1].init.method).toBe("DELETE");
  });

  it("surfaces the gateway error message and status", async () => {
    const { fetchImpl } = fakeFetch(() => json({ error: "Unauthorized" }, 401));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    await expect(api.listKeys()).rejects.toMatchObject({ name: "ApiError", message: "Unauthorized", status: 401 });
    await expect(api.listKeys()).rejects.toBeInstanceOf(ApiError);
  });

  it("falls back to a route description for non-JSON failures", async () => {
    const { fetchImpl } = fakeFetch(() => ({ ok: false, status: 502, text: async () => "bad gateway" }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    await expect(api.listKeys()).rejects.toMatchObject({ message: "GET /api/keys failed (502)", status: 502 });
  });
});
