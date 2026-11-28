// Minimal client for the isolated gateway's dashboard APIs.
//
// The shell runs on the same machine as its own gateway, so it authenticates
// with the local CLI token instead of a dashboard session cookie. Errors carry
// the gateway's own message so the UI can show the real reason.
export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export function createGatewayApi({ baseUrl, token = null, fetchImpl = fetch, timeoutMs = 8000 }) {
  async function request(route, { method = "GET", body, extraHeaders = null, timeout = null } = {}) {
    const headers = { ...(extraHeaders || {}) };
    if (token) headers["x-9r-cli-token"] = token;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetchImpl(`${baseUrl}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout || timeoutMs),
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const raw = parsed && parsed.error;
      const message =
        (typeof raw === "string" && raw) ||
        (raw && raw.message) ||
        `${method} ${route} failed (${response.status})`;
      throw new ApiError(message, response.status, parsed);
    }
    return parsed;
  }

  // Server-sent events: each `data:` line is one JSON event; `[DONE]` ends the
  // stream. The response body is read incrementally so the caller renders while
  // the gateway is still producing tokens.
  async function streamRequest(route, { body, extraHeaders = null, timeout = 60000, signal = null, onEvent } = {}) {
    const headers = { ...(extraHeaders || {}), accept: "text/event-stream" };
    if (token) headers["x-9r-cli-token"] = token;
    if (body !== undefined) headers["content-type"] = "application/json";
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("request timed out"));
    }, timeout);
    const forwardAbort = () => controller.abort(signal.reason);
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener("abort", forwardAbort, { once: true });
    }
    try {
      const response = await fetchImpl(`${baseUrl}${route}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        const raw = parsed && parsed.error;
        const message =
          (typeof raw === "string" && raw) ||
          (raw && raw.message) ||
          `POST ${route} failed (${response.status})`;
        throw new ApiError(message, response.status, parsed);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const consume = (line) => {
        if (!line.startsWith("data:")) return false;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return true;
        let event = null;
        try {
          event = JSON.parse(data);
        } catch {
          return false;
        }
        if (event && event.error) {
          const raw = event.error;
          const message = (typeof raw === "string" && raw) || (raw && raw.message) || "provider stream error";
          throw new ApiError(message, response.status, event);
        }
        if (onEvent) onEvent(event);
        return false;
      };
      let buffer = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (consume(line)) return;
          }
        }
        // A stream may end without a trailing newline; flush the last event.
        const tail = buffer.trim();
        if (tail) consume(tail);
      } catch (error) {
        if (timedOut && !(signal && signal.aborted)) {
          throw new ApiError(`stream timed out after ${timeout} ms`, 0);
        }
        throw error;
      }
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", forwardAbort);
    }
  }

  return {
    listKeys: async () => {
      const body = await request("/api/keys");
      return (body && body.keys) || [];
    },
    createKey: (name) => request("/api/keys", { method: "POST", body: { name } }),
    updateKey: (id, patch) => request(`/api/keys/${encodeURIComponent(id)}`, { method: "PUT", body: patch }),
    deleteKey: (id) => request(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
    listProviders: async () => {
      const body = await request("/api/providers");
      return (body && body.connections) || [];
    },
    updateProvider: (id, patch) => request(`/api/providers/${encodeURIComponent(id)}`, { method: "PUT", body: patch }),
    createProvider: (body) => request("/api/providers", { method: "POST", body }),
    deleteProvider: (id) => request(`/api/providers/${encodeURIComponent(id)}`, { method: "DELETE" }),
    testProvider: (id) => request(`/api/providers/${encodeURIComponent(id)}/test`, { method: "POST" }),
    validateProvider: (provider, apiKey) =>
      request("/api/providers/validate", { method: "POST", body: { provider, apiKey } }),
    listProviderNodes: async () => {
      const body = await request("/api/provider-nodes");
      return (body && body.nodes) || [];
    },
    createProviderNode: (node) => request("/api/provider-nodes", { method: "POST", body: node }),
    updateProviderNode: (id, patch) =>
      request(`/api/provider-nodes/${encodeURIComponent(id)}`, { method: "PUT", body: patch }),
    deleteProviderNode: (id) => request(`/api/provider-nodes/${encodeURIComponent(id)}`, { method: "DELETE" }),
    getModels: async () => {
      const body = await request("/api/models");
      return (body && body.models) || [];
    },
    getDisabledModels: async () => {
      const body = await request("/api/models/disabled");
      return (body && body.disabled) || {};
    },
    disableModels: (providerAlias, ids) =>
      request("/api/models/disabled", { method: "POST", body: { providerAlias, ids } }),
    enableModel: (providerAlias, id) =>
      request(
        `/api/models/disabled?providerAlias=${encodeURIComponent(providerAlias)}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      ),
    enableAllModels: (providerAlias) =>
      request(`/api/models/disabled?providerAlias=${encodeURIComponent(providerAlias)}`, { method: "DELETE" }),
    listCustomModels: async () => {
      const body = await request("/api/models/custom");
      return (body && body.models) || [];
    },
    addCustomModel: ({ providerAlias, id, type = "llm" }) =>
      request("/api/models/custom", { method: "POST", body: { providerAlias, id, type } }),
    deleteCustomModel: (providerAlias, id, type = "llm") =>
      request(
        `/api/models/custom?providerAlias=${encodeURIComponent(providerAlias)}&id=${encodeURIComponent(id)}&type=${type}`,
        { method: "DELETE" }
      ),
    setModelAlias: (model, alias) => request("/api/models/alias", { method: "PUT", body: { model, alias } }),    deleteModelAlias: (alias) =>
      request(`/api/models/alias?alias=${encodeURIComponent(alias)}`, { method: "DELETE" }),
    testModel: (model, kind = "llm") => request("/api/models/test", { method: "POST", body: { model, kind } }),
    getModelAvailability: () => request("/api/models/availability"),
    clearModelCooldown: (provider, model) =>
      request("/api/models/availability", { method: "POST", body: { action: "clearCooldown", provider, model } }),
    getUsageStats: (period) => request(`/api/usage/stats?period=${encodeURIComponent(period)}`),
    getUsageChart: (period) => request(`/api/usage/chart?period=${encodeURIComponent(period)}`),
    getConnectionUsage: (id, { force = false } = {}) =>
      request(`/api/usage/${encodeURIComponent(id)}${force ? "?force=1" : ""}`),
    getUsageProviders: async () => {
      const body = await request("/api/usage/providers");
      return (body && body.providers) || [];
    },
    getRequestDetails: (page = 1, pageSize = 20, filters = {}) => {
      const parts = [`page=${page}`, `pageSize=${pageSize}`];
      for (const key of ["provider", "model", "status", "startDate", "endDate"]) {
        if (filters[key]) parts.push(`${key}=${encodeURIComponent(filters[key])}`);
      }
      return request(`/api/usage/request-details?${parts.join("&")}`);
    },
    listCombos: async () => {
      const body = await request("/api/combos");
      return (body && body.combos) || [];
    },
    createCombo: (name, kind = null) =>
      request("/api/combos", { method: "POST", body: { name, ...(kind ? { kind } : {}) } }),
    updateCombo: (id, patch) => request(`/api/combos/${encodeURIComponent(id)}`, { method: "PUT", body: patch }),
    getComboPresets: (source) => request(`/api/combos/presets?source=${encodeURIComponent(source)}`),
    createComboPresets: (source) => request("/api/combos/presets", { method: "POST", body: { source } }),
    deleteCombo: (id) => request(`/api/combos/${encodeURIComponent(id)}`, { method: "DELETE" }),
    getConsoleLogs: async () => {
      const body = await request("/api/translator/console-logs");
      return (body && body.logs) || [];
    },
    clearConsoleLogs: () => request("/api/translator/console-logs", { method: "DELETE" }),
    getSettings: () => request("/api/settings"),
    // The gateway trusts this shell through the local CLI token; the password
    // header is only sent when the user typed one.
    getDatabaseBackup: (password = "") =>
      request("/api/settings/database", {
        extraHeaders: password ? { "x-9r-password": password } : null,
      }),
    importDatabase: (payload, password) =>
      request("/api/settings/database", { method: "POST", body: { ...payload, password } }),
    getTunnelStatus: () => request("/api/tunnel/status"),
    patchSettings: (patch) => request("/api/settings", { method: "PATCH", body: patch }),
    testProxyUrl: (proxyUrl) =>
      request("/api/settings/proxy-test", { method: "POST", body: { proxyUrl } }),
    createChatCompletion: ({ apiKey, model, messages, timeout = 60000 }) =>
      request("/v1/chat/completions", {
        method: "POST",
        body: { model, messages, stream: false },
        extraHeaders: apiKey ? { authorization: `Bearer ${apiKey}` } : null,
        timeout,
      }),
    streamChatCompletion: ({ apiKey, model, messages, onDelta, signal = null, timeout = 120000 }) =>
      streamRequest("/v1/chat/completions", {
        body: { model, messages, stream: true },
        extraHeaders: apiKey ? { authorization: `Bearer ${apiKey}` } : null,
        timeout,
        signal,
        onEvent: (event) => {
          const delta = event && event.choices && event.choices[0] && event.choices[0].delta;
          const content = delta && delta.content;
          if (typeof content === "string" && content) onDelta(content);
        },
      }),
    getPricing: () => request("/api/pricing"),
    patchPricing: (pricing) => request("/api/pricing", { method: "PATCH", body: pricing }),
    resetPricing: (provider = null, model = null) => {
      const parts = [];
      if (provider) parts.push(`provider=${encodeURIComponent(provider)}`);
      if (provider && model) parts.push(`model=${encodeURIComponent(model)}`);
      return request(`/api/pricing${parts.length ? `?${parts.join("&")}` : ""}`, { method: "DELETE" });
    },
    getTokenSaverStats: (period) => request(`/api/token-saver/stats?period=${encodeURIComponent(period)}`),
    getHeadroomStatus: () => request("/api/headroom/status"),
    listProxyPools: async (includeUsage = false) => {
      const body = await request(`/api/proxy-pools${includeUsage ? "?includeUsage=true" : ""}`);
      return (body && body.proxyPools) || [];
    },
    createProxyPool: (pool) => request("/api/proxy-pools", { method: "POST", body: pool }),
    updateProxyPool: (id, patch) =>
      request(`/api/proxy-pools/${encodeURIComponent(id)}`, { method: "PUT", body: patch }),
    deleteProxyPool: (id) => request(`/api/proxy-pools/${encodeURIComponent(id)}`, { method: "DELETE" }),
    testProxyPool: (id) => request(`/api/proxy-pools/${encodeURIComponent(id)}/test`, { method: "POST" }),
    getCliToolStatuses: () => request("/api/cli-tools/all-statuses"),
    getTranslatorFile: async (file) => {
      const body = await request(`/api/translator/load?file=${encodeURIComponent(file)}`);
      return (body && body.content) || "";
    },
    saveTranslatorFile: (file, content) =>
      request("/api/translator/save", { method: "POST", body: { file, content } }),
  };
}
