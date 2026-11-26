// Read-only status model for the experimental shell's first screen.
//
// Pure state transitions over an injected fetch, so the shell's correctness can
// be tested without a GPU, a window, or a live gateway.
export const STATUS = {
  connecting: "connecting",
  ready: "ready",
  degraded: "degraded",
};

export function initialStatus({ port, dataDir, runtimeDir }) {
  return {
    phase: STATUS.connecting,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    dataDir,
    runtimeDir,
    version: null,
    latestVersion: null,
    hasUpdate: false,
    lastError: null,
    checkedAt: null,
  };
}

export function reduceStatus(state, action) {
  switch (action.type) {
    case "connected":
      return {
        ...state,
        phase: STATUS.ready,
        version: action.version ?? state.version,
        latestVersion: action.latestVersion ?? null,
        hasUpdate: Boolean(action.hasUpdate),
        lastError: null,
        checkedAt: action.checkedAt ?? Date.now(),
      };
    case "failed":
      return { ...state, phase: STATUS.degraded, lastError: action.error, checkedAt: Date.now() };
    case "checking":
      return { ...state, phase: STATUS.connecting, lastError: null };
    default:
      return state;
  }
}

export function describeStatus(state) {
  if (state.phase === STATUS.ready) return `Gateway healthy on port ${state.port}`;
  if (state.phase === STATUS.degraded) return `Gateway unavailable: ${state.lastError || "unknown error"}`;
  return `Connecting to gateway on port ${state.port}...`;
}

// /api/version performs an outbound npm lookup, so treat its absence as
// non-fatal: health is the gate, version is decoration.
export async function probeGateway({ baseUrl, fetchImpl = fetch, timeoutMs = 4000 }) {
  const health = await fetchImpl(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!health.ok) throw new Error(`/api/health returned status ${health.status}`);
  const healthBody = await health.json();
  if (!healthBody || healthBody.ok !== true) {
    throw new Error(`/api/health returned ${JSON.stringify(healthBody)}`);
  }
  try {
    const versionRes = await fetchImpl(`${baseUrl}/api/version`, { signal: AbortSignal.timeout(timeoutMs) });
    if (versionRes.ok) {
      const body = await versionRes.json();
      return {
        version: body.currentVersion ?? null,
        latestVersion: body.latestVersion ?? null,
        hasUpdate: Boolean(body.hasUpdate),
      };
    }
  } catch {
    // Version is optional.
  }
  return { version: null, latestVersion: null, hasUpdate: false };
}

export async function refreshStatus(state, { fetchImpl = fetch } = {}) {
  try {
    const result = await probeGateway({ baseUrl: state.baseUrl, fetchImpl });
    return reduceStatus(state, { type: "connected", ...result });
  } catch (error) {
    return reduceStatus(state, { type: "failed", error: error && error.message ? error.message : String(error) });
  }
}
