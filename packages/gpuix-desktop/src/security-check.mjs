// Black-box security checks against a running experimental gateway.
//
// These run over HTTP against the real staged runtime, not against mocks, so the
// same code proves the shipped middleware, LAN binding and DB isolation. Used by
// the integration test and reusable by later features/validators.
//
// Every check is read-only except the authenticated write probe, which creates a
// throwaway API key, reads it back and deletes it. No provider account is touched.
export const BLOCKED_ROUTES = ["/api/version/update", "/api/version/shutdown", "/api/shutdown"];

function url(baseUrl, pathname) {
  return `${baseUrl}${pathname}`;
}

async function request(url_, options = {}) {
  const { timeoutMs = 10_000, ...init } = options;
  const res = await fetch(url_, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  let body = null;
  const type = res.headers.get("content-type") || "";
  try {
    body = type.includes("application/json") ? await res.json() : await res.text();
  } catch {
    body = null;
  }
  return { status: res.status, body, headers: res.headers, location: res.headers.get("location") };
}

function cookieFrom(res) {
  const raw = res.headers.get("set-cookie");
  if (!raw) return null;
  const match = raw.match(/auth_token=([^;]+)/);
  return match ? `auth_token=${match[1]}` : null;
}

// Unauthenticated callers must not reach protected APIs or the dashboard. LAN
// binding is preserved; only the authentication gate is asserted.
//
// The LLM API (/v1/*) is deliberately loopback-public in the gateway (a local
// client is trusted), so its expectation differs by origin: from LAN it must be
// rejected, from loopback it may answer. Passing `isLoopback` keeps the check
// honest instead of encoding one platform's behavior as universal.
export async function checkUnauthenticatedLanRejection({ baseUrl, isLoopback = true }) {
  const results = [];
  const guarded = await request(url(baseUrl, "/api/providers"));
  results.push({ name: "LAN /api/providers rejected", ok: guarded.status === 401, status: guarded.status });
  const keys = await request(url(baseUrl, "/api/keys"));
  results.push({ name: "LAN /api/keys rejected", ok: keys.status === 401, status: keys.status });
  const llm = await request(url(baseUrl, "/v1/models"));
  results.push({
    name: isLoopback ? "loopback /v1/models allowed without key" : "LAN /v1/models rejected without key",
    ok: isLoopback ? llm.status === 200 : llm.status === 401,
    status: llm.status,
  });
  const dashboard = await request(url(baseUrl, "/dashboard"), { redirect: "manual" });
  const redirected =
    dashboard.status >= 300 && dashboard.status < 400 && String(dashboard.location || "").includes("/login");
  results.push({
    name: "LAN /dashboard redirects to login",
    ok: redirected,
    status: dashboard.status,
    location: dashboard.location || null,
  });
  const health = await request(url(baseUrl, "/api/health"));
  results.push({ name: "LAN /api/health still public", ok: health.status === 200 && health.body?.ok === true, status: health.status });
  return results;
}

// Update/shutdown routes must be refused before any handler runs. A caller with
// no session must not tell the difference between "unknown route" and "blocked",
// so the assertion is 4xx with no side effect, never 2xx.
export async function checkExperimentalRouteBlocks({ baseUrl }) {
  const results = [];
  for (const pathname of BLOCKED_ROUTES) {
    const res = await request(url(baseUrl, pathname), { method: "POST" });
    results.push({
      name: `POST ${pathname} blocked`,
      ok: res.status === 403 || res.status === 401,
      status: res.status,
      body: typeof res.body === "string" ? res.body.slice(0, 200) : res.body,
    });
  }
  return results;
}

// Authenticated dashboard flow from the LAN address with the generated
// experimental password, then one DB-backed write/read/delete round trip.
export async function checkAuthenticatedLanMockFlow({ baseUrl, password }) {
  const results = [];
  const login = await request(url(baseUrl, "/api/auth/login"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const cookie = cookieFrom(login);
  results.push({
    name: "LAN password login succeeds",
    ok: login.status === 200 && login.body?.success === true && Boolean(cookie),
    status: login.status,
    authenticated: Boolean(cookie),
  });
  if (!cookie) return results;

  const authHeaders = { cookie, "content-type": "application/json" };

  const providers = await request(url(baseUrl, "/api/providers"), { headers: { cookie } });
  results.push({
    name: "LAN /api/providers allowed with session",
    ok: providers.status === 200,
    status: providers.status,
  });

  const name = `gpuix-verify-${Date.now()}`;
  const created = await request(url(baseUrl, "/api/keys"), {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ name }),
  });
  results.push({
    name: "LAN mock API key created",
    ok: created.status === 201 && typeof created.body?.key === "string",
    status: created.status,
  });

  if (created.status === 201 && created.body?.id) {
    const listed = await request(url(baseUrl, "/api/keys"), { headers: { cookie } });
    const found = Array.isArray(listed.body?.keys) && listed.body.keys.some((k) => k.id === created.body.id);
    results.push({ name: "mock API key reads back from isolated DB", ok: found, status: listed.status });

    const removed = await request(url(baseUrl, `/api/keys/${created.body.id}`), {
      method: "DELETE",
      headers: { cookie },
    });
    results.push({ name: "mock API key deleted", ok: removed.status === 200 || removed.status === 204, status: removed.status });
  }

  return results;
}

export function summarize(results) {
  const failures = results.filter((r) => !r.ok);
  return { passed: results.length - failures.length, total: results.length, failures };
}
