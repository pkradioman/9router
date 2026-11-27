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
    getUsageStats: (period) => request(`/api/usage/stats?period=${encodeURIComponent(period)}`),
    listCombos: async () => {
      const body = await request("/api/combos");
      return (body && body.combos) || [];
    },
    createCombo: (name) => request("/api/combos", { method: "POST", body: { name } }),
    deleteCombo: (id) => request(`/api/combos/${encodeURIComponent(id)}`, { method: "DELETE" }),
    getConsoleLogs: async () => {
      const body = await request("/api/translator/console-logs");
      return (body && body.logs) || [];
    },
    clearConsoleLogs: () => request("/api/translator/console-logs", { method: "DELETE" }),
    getSettings: () => request("/api/settings"),
    patchSettings: (patch) => request("/api/settings", { method: "PATCH", body: patch }),
    getTokenSaverStats: (period) => request(`/api/token-saver/stats?period=${encodeURIComponent(period)}`),
    listProxyPools: async () => {
      const body = await request("/api/proxy-pools");
      return (body && body.proxyPools) || [];
    },
    createProxyPool: (pool) => request("/api/proxy-pools", { method: "POST", body: pool }),
    updateProxyPool: (id, patch) =>
      request(`/api/proxy-pools/${encodeURIComponent(id)}`, { method: "PUT", body: patch }),
    deleteProxyPool: (id) => request(`/api/proxy-pools/${encodeURIComponent(id)}`, { method: "DELETE" }),
  };
}
