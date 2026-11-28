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

  it("fetches CLI tool statuses", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ claude: { installed: true } }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    expect(await api.getCliToolStatuses()).toEqual({ claude: { installed: true } });
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/cli-tools/all-statuses");
  });

  it("loads a translator step file", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ success: true, content: "{\"ok\":true}" }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    expect(await api.getTranslatorFile("1_req_client.json")).toBe("{\"ok\":true}");
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/translator/load?file=1_req_client.json");
  });

  it("manages provider nodes", async () => {
    const { calls, fetchImpl } = fakeFetch((url, init) => {
      if (init.method === "POST") return json({ node: { id: "n1" } }, 201);
      if (init.method === "DELETE") return json({ success: true });
      return json({ nodes: [{ id: "n0", name: "old" }] });
    });
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    expect(await api.listProviderNodes()).toEqual([{ id: "n0", name: "old" }]);
    await api.createProviderNode({ name: "Local", prefix: "loc", baseUrl: "http://h/v1", apiType: "chat" });
    await api.deleteProviderNode("n1");
    expect(calls[1].url).toBe("http://127.0.0.1:20129/api/provider-nodes");
    expect(calls[2].url).toBe("http://127.0.0.1:20129/api/provider-nodes/n1");
    expect(calls[2].init.method).toBe("DELETE");
  });

  it("fetches paged request details", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ details: [], pagination: { page: 1 } }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    await api.getRequestDetails(3, 10);
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/usage/request-details?page=3&pageSize=10");
  });

  it("appends request-detail filters", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ details: [] }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    await api.getRequestDetails(2, 10, {
      provider: "open ai",
      model: "gpt-4o",
      status: "500",
      startDate: "2026-11-01",
      endDate: "",
    });
    expect(calls[0].url).toBe(
      "http://127.0.0.1:20129/api/usage/request-details?page=2&pageSize=10&provider=open%20ai&model=gpt-4o&status=500&startDate=2026-11-01"
    );
  });

  it("posts a provider connection test", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ valid: true }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    expect(await api.testProvider("p 1")).toEqual({ valid: true });
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/providers/p%201/test");
    expect(calls[0].init.method).toBe("POST");
  });

  it("requests usage chart data for the selected period", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json([{ label: "Mon", tokens: 1 }]));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    expect(await api.getUsageChart("24h")).toEqual([{ label: "Mon", tokens: 1 }]);
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/usage/chart?period=24h");
  });

  it("manages models through the dashboard model routes", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ models: [] }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    await api.getModels();
    await api.getDisabledModels();
    await api.disableModels("open ai", ["gpt-4o"]);
    await api.enableModel("open ai", "g p t");
    await api.enableAllModels("open ai");
    await api.listCustomModels();
    await api.addCustomModel({ providerAlias: "open ai", id: "my model", type: "llm" });
    await api.deleteCustomModel("open ai", "my model");
    await api.setModelAlias("open ai/gpt-4o", "fast");
    await api.deleteModelAlias("fast");

    expect(calls.map((call) => `${call.init.method} ${call.url.replace("http://127.0.0.1:20129", "")}`)).toEqual([
      "GET /api/models",
      "GET /api/models/disabled",
      "POST /api/models/disabled",
      "DELETE /api/models/disabled?providerAlias=open%20ai&id=g%20p%20t",
      "DELETE /api/models/disabled?providerAlias=open%20ai",
      "GET /api/models/custom",
      "POST /api/models/custom",
      "DELETE /api/models/custom?providerAlias=open%20ai&id=my%20model&type=llm",
      "PUT /api/models/alias",
      "DELETE /api/models/alias?alias=fast",
    ]);
    expect(JSON.parse(calls[2].init.body)).toEqual({ providerAlias: "open ai", ids: ["gpt-4o"] });
    expect(JSON.parse(calls[6].init.body)).toEqual({ providerAlias: "open ai", id: "my model", type: "llm" });
  });

  it("reads tunnel and tailscale status", async () => {
    const body = { tunnel: { publicUrl: "https://probe.trycloudflare.com" }, tailscale: null };
    const { calls, fetchImpl } = fakeFetch(() => json(body));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    expect(await api.getTunnelStatus()).toEqual(body);
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/tunnel/status");
  });

  it("tests a routed model", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ ok: true }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    expect(await api.testModel("openai/gpt-4o")).toEqual({ ok: true });
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/models/test");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body)).toEqual({ model: "openai/gpt-4o", kind: "llm" });
  });

  it("tests an outbound proxy url", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ ok: true, status: 200, elapsedMs: 12 }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    expect(await api.testProxyUrl("http://127.0.0.1:9")).toEqual({ ok: true, status: 200, elapsedMs: 12 });
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/settings/proxy-test");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body)).toEqual({ proxyUrl: "http://127.0.0.1:9" });
  });

  it("updates a provider node", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ node: { id: "n 1" } }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    await api.updateProviderNode("n 1", { name: "Local", prefix: "loc" });
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/provider-nodes/n%201");
    expect(calls[0].init.method).toBe("PUT");
    expect(JSON.parse(calls[0].init.body)).toEqual({ name: "Local", prefix: "loc" });
  });

  it("posts a proxy pool test", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ ok: true, status: 200, elapsedMs: 42 }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    expect(await api.testProxyPool("pp 1")).toEqual({ ok: true, status: 200, elapsedMs: 42 });
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/proxy-pools/pp%201/test");
    expect(calls[0].init.method).toBe("POST");
  });

  it("requests proxy pools with binding counts", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ proxyPools: [] }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    await api.listProxyPools(true);
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/proxy-pools?includeUsage=true");
  });

  it("reads headroom status", async () => {
    const body = { installed: false, running: false, version: null, url: "http://127.0.0.1:5757" };
    const { calls, fetchImpl } = fakeFetch(() => json(body));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    expect(await api.getHeadroomStatus()).toEqual(body);
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/headroom/status");
  });

  it("reads and creates combo presets", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ source: "claude", items: [] }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    await api.getComboPresets("claude");
    await api.createComboPresets("cursor");
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/combos/presets?source=claude");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[1].url).toBe("http://127.0.0.1:20129/api/combos/presets");
    expect(calls[1].init.method).toBe("POST");
    expect(JSON.parse(calls[1].init.body)).toEqual({ source: "cursor" });
  });

  it("creates a combo with a media kind", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ id: "c1", name: "search-combo", kind: "webSearch" }, 201));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    await api.createCombo("search-combo", "webSearch");
    expect(calls[0].init.body).toBe('{"name":"search-combo","kind":"webSearch"}');
  });

  it("updates a combo by id", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ id: "c 1", name: "mix", models: [] }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    await api.updateCombo("c 1", { name: "mix", models: ["openai/gpt-4o"] });
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/combos/c%201");
    expect(calls[0].init.method).toBe("PUT");
    expect(JSON.parse(calls[0].init.body)).toEqual({ name: "mix", models: ["openai/gpt-4o"] });
  });

  it("lists usage providers and posts a non-streaming chat completion", async () => {
    const { calls, fetchImpl } = fakeFetch((url) =>
      url.endsWith("/api/usage/providers")
        ? json({ providers: [{ id: "openai", name: "OpenAI" }] })
        : json({ choices: [{ message: { role: "assistant", content: "hi" } }] })
    );
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    expect(await api.getUsageProviders()).toEqual([{ id: "openai", name: "OpenAI" }]);
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/usage/providers");

    const body = await api.createChatCompletion({
      apiKey: "sk-test",
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(body.choices[0].message.content).toBe("hi");
    expect(calls[1].url).toBe("http://127.0.0.1:20129/v1/chat/completions");
    expect(calls[1].init.headers.authorization).toBe("Bearer sk-test");
    expect(JSON.parse(calls[1].init.body)).toEqual({
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    });
  });

  it("uses a structured gateway error message when the API returns one", async () => {
    const { fetchImpl } = fakeFetch(() => json({ error: { message: "invalid api key" } }, 401));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });
    await expect(api.createChatCompletion({ model: "m", messages: [] })).rejects.toMatchObject({
      message: "invalid api key",
      status: 401,
    });
  });

  it("streams chat deltas until [DONE]", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"con',
      'tent":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{}}]}\n\ndata: [DONE]\n\n',
      'data: {"choices":[{"delta":{"content":"ignored"}}]}\n\n',
    ];
    const { calls, fetchImpl } = fakeFetch(() => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
    }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", token: "tok", fetchImpl });
    const deltas = [];

    await api.streamChatCompletion({
      apiKey: "sk-1",
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      onDelta: (delta) => deltas.push(delta),
    });

    expect(deltas).toEqual(["Hel", "lo"]);
    expect(calls[0].url).toBe("http://127.0.0.1:20129/v1/chat/completions");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.authorization).toBe("Bearer sk-1");
    expect(calls[0].init.headers["x-9r-cli-token"]).toBe("tok");
    expect(calls[0].init.headers.accept).toBe("text/event-stream");
    expect(JSON.parse(calls[0].init.body)).toEqual({
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
  });

  it("rejects an error frame in the middle of a stream and flushes a tail without newline", async () => {
    const encoder = new TextEncoder();
    const mk = (chunks) => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
    });
    const deltas = [];
    const api = createGatewayApi({
      baseUrl: "http://127.0.0.1:20129",
      fetchImpl: async () => mk(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"error":{"message":"upstream reset"}}\n\n']),
    });
    await expect(
      api.streamChatCompletion({ model: "m", messages: [], onDelta: (delta) => deltas.push(delta) })
    ).rejects.toMatchObject({ name: "ApiError", message: "upstream reset" });
    expect(deltas).toEqual(["ok"]);

    const tailApi = createGatewayApi({
      baseUrl: "http://127.0.0.1:20129",
      fetchImpl: async () => mk(['data: {"choices":[{"delta":{"content":"tail"}}]}']),
    });
    const tail = [];
    await tailApi.streamChatCompletion({ model: "m", messages: [], onDelta: (delta) => tail.push(delta) });
    expect(tail).toEqual(["tail"]);
  });

  it("throws the gateway message for a failed stream", async () => {
    const { fetchImpl } = fakeFetch(() => ({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { message: "rate limited" } }),
    }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    await expect(
      api.streamChatCompletion({ model: "m", messages: [], onDelta: () => {} })
    ).rejects.toMatchObject({ name: "ApiError", message: "rate limited", status: 429 });
  });

  it("reads model availability and clears a cooldown", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ models: [], unavailableCount: 0 }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    expect(await api.getModelAvailability()).toEqual({ models: [], unavailableCount: 0 });
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/models/availability");

    await api.clearModelCooldown("openai", "gpt-4o");
    expect(calls[1].url).toBe("http://127.0.0.1:20129/api/models/availability");
    expect(calls[1].init.method).toBe("POST");
    expect(JSON.parse(calls[1].init.body)).toEqual({
      action: "clearCooldown",
      provider: "openai",
      model: "gpt-4o",
    });
  });

  it("saves a translator step file", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ success: true }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", token: "tok", fetchImpl });

    await api.saveTranslatorFile("7_res_client.txt", "payload");
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/translator/save");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body)).toEqual({ file: "7_res_client.txt", content: "payload" });
  });

  it("exports and imports the database over the CLI token", async () => {
    const { calls, fetchImpl } = fakeFetch((url, init) =>
      init.method === "POST" ? json({ success: true }) : json({ version: 1, tables: {} })
    );
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", token: "tok", fetchImpl });

    expect(await api.getDatabaseBackup()).toEqual({ version: 1, tables: {} });
    expect(calls[0].init.headers["x-9r-cli-token"]).toBe("tok");
    expect(calls[0].init.headers["x-9r-password"]).toBeUndefined();

    await api.getDatabaseBackup("pw");
    expect(calls[1].init.headers["x-9r-password"]).toBe("pw");

    await api.importDatabase({ version: 1, tables: {} }, "pw");
    expect(JSON.parse(calls[2].init.body)).toEqual({ version: 1, tables: {}, password: "pw" });
  });

  it("reads one connection's quota, optionally forced", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ quotas: { five_hour: { used: 1, total: 2 } } }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", token: "tok", fetchImpl });

    expect(await api.getConnectionUsage("p 1")).toEqual({ quotas: { five_hour: { used: 1, total: 2 } } });
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/usage/p%201");
    expect(calls[0].init.headers["x-9r-cli-token"]).toBe("tok");

    await api.getConnectionUsage("p1", { force: true });
    expect(calls[1].url).toBe("http://127.0.0.1:20129/api/usage/p1?force=1");
  });

  it("reads and writes pricing overrides", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({ openai: { "gpt-4o": { input: 2.5, output: 10 } } }));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    expect(await api.getPricing()).toEqual({ openai: { "gpt-4o": { input: 2.5, output: 10 } } });
    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/pricing");

    await api.patchPricing({ openai: { "gpt-4o": { input: 3, output: 12, cached: 1.5 } } });
    expect(calls[1].url).toBe("http://127.0.0.1:20129/api/pricing");
    expect(calls[1].init.method).toBe("PATCH");
    expect(JSON.parse(calls[1].init.body)).toEqual({
      openai: { "gpt-4o": { input: 3, output: 12, cached: 1.5 } },
    });
  });

  it("resets one model, one provider, or all pricing", async () => {
    const { calls, fetchImpl } = fakeFetch(() => json({}));
    const api = createGatewayApi({ baseUrl: "http://127.0.0.1:20129", fetchImpl });

    await api.resetPricing();
    await api.resetPricing("open ai");
    await api.resetPricing("open ai", "gpt-4o mini");

    expect(calls[0].url).toBe("http://127.0.0.1:20129/api/pricing");
    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[1].url).toBe("http://127.0.0.1:20129/api/pricing?provider=open%20ai");
    expect(calls[2].url).toBe(
      "http://127.0.0.1:20129/api/pricing?provider=open%20ai&model=gpt-4o%20mini"
    );
    expect(calls[2].init.method).toBe("DELETE");
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
