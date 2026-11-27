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
  async function request(route, { method = "GET", body } = {}) {
    const headers = {};
    if (token) headers["x-9r-cli-token"] = token;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetchImpl(`${baseUrl}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const message = (parsed && parsed.error) || `${method} ${route} failed (${response.status})`;
      throw new ApiError(message, response.status, parsed);
    }
    return parsed;
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
    getUsageStats: (period) => request(`/api/usage/stats?period=${encodeURIComponent(period)}`),
    getUsageChart: (period) => request(`/api/usage/chart?period=${encodeURIComponent(period)}`),
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
    createCombo: (name) => request("/api/combos", { method: "POST", body: { name } }),
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
    getTunnelStatus: () => request("/api/tunnel/status"),
    patchSettings: (patch) => request("/api/settings", { method: "PATCH", body: patch }),
    testProxyUrl: (proxyUrl) =>
      request("/api/settings/proxy-test", { method: "POST", body: { proxyUrl } }),
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
  };
}
