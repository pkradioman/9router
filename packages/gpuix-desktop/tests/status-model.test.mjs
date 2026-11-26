import { describe, expect, it } from "vitest";
import { describeStatus, initialStatus, reduceStatus, refreshStatus, STATUS } from "../src/ui/status-model.mjs";

function base() {
  return initialStatus({ port: 20129, dataDir: "C:/data", runtimeDir: "C:/runtime" });
}

function fakeFetch(routes) {
  return async (url) => {
    const path = new URL(url).pathname;
    const handler = routes[path];
    if (!handler) return { ok: false, status: 404, json: async () => ({}) };
    const result = typeof handler === "function" ? await handler() : handler;
    return {
      ok: result.status === undefined || result.status < 400,
      status: result.status ?? 200,
      json: async () => result.body,
    };
  };
}

describe("status model", () => {
  it("starts in connecting state on the experimental port", () => {
    const state = base();
    expect(state.phase).toBe(STATUS.connecting);
    expect(state.port).toBe(20129);
    expect(state.baseUrl).toBe("http://127.0.0.1:20129");
    expect(describeStatus(state)).toContain("20129");
  });

  it("marks ready with version data when health and version respond", async () => {
    const fetchImpl = fakeFetch({
      "/api/health": { body: { ok: true } },
      "/api/version": { body: { currentVersion: "0.5.126", latestVersion: null, hasUpdate: false } },
    });
    const state = await refreshStatus(base(), { fetchImpl });
    expect(state.phase).toBe(STATUS.ready);
    expect(state.version).toBe("0.5.126");
    expect(state.hasUpdate).toBe(false);
    expect(describeStatus(state)).toContain("healthy");
  });

  it("stays ready when the version lookup fails (it needs the network)", async () => {
    const fetchImpl = fakeFetch({
      "/api/health": { body: { ok: true } },
      "/api/version": { status: 500, body: {} },
    });
    const state = await refreshStatus(base(), { fetchImpl });
    expect(state.phase).toBe(STATUS.ready);
    expect(state.version).toBeNull();
  });

  it("degrades with the error message when health fails", async () => {
    const fetchImpl = fakeFetch({ "/api/health": { status: 503, body: {} } });
    const state = await refreshStatus(base(), { fetchImpl });
    expect(state.phase).toBe(STATUS.degraded);
    expect(state.lastError).toMatch(/503/);
    expect(describeStatus(state)).toContain("unavailable");
  });

  it("treats a non-ok health body as a failure", async () => {
    const fetchImpl = fakeFetch({ "/api/health": { body: { ok: false } } });
    const state = await refreshStatus(base(), { fetchImpl });
    expect(state.phase).toBe(STATUS.degraded);
  });

  it("clears the previous error when a retry succeeds", async () => {
    const failed = reduceStatus(base(), { type: "failed", error: "boom" });
    const recovered = reduceStatus(failed, { type: "connected", version: "1.0.0" });
    expect(recovered.lastError).toBeNull();
    expect(recovered.version).toBe("1.0.0");
  });
});
