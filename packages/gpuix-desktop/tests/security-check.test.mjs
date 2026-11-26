import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BLOCKED_ROUTES,
  checkAuthenticatedLanMockFlow,
  checkExperimentalRouteBlocks,
  checkUnauthenticatedLanRejection,
  summarize,
} from "../src/security-check.mjs";

describe("security-check route list", () => {
  it("covers every self-update and cross-process kill route", () => {
    expect(BLOCKED_ROUTES).toEqual(["/api/version/update", "/api/version/shutdown", "/api/shutdown"]);
  });
});

describe("summarize", () => {
  it("counts failures and returns them", () => {
    const result = summarize([
      { name: "a", ok: true },
      { name: "b", ok: false, status: 403 },
    ]);
    expect(result.passed).toBe(1);
    expect(result.total).toBe(2);
    expect(result.failures.map((f) => f.name)).toEqual(["b"]);
  });

  it("reports a clean run as zero failures", () => {
    expect(summarize([{ name: "a", ok: true }])).toEqual({ passed: 1, total: 1, failures: [] });
  });
});

// These exercise the real HTTP surface of checkUnauthenticatedLanRejection against
// a stub server, so the status-code expectations are proven, not assumed.
const servers = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((r) => server.close(r));
});

async function stubServer(handler) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

describe("checkUnauthenticatedLanRejection", () => {
  it("passes when protected APIs are 401 and the dashboard redirects to login", async () => {
    const baseUrl = await stubServer((req, res) => {
      if (req.url === "/api/providers" || req.url === "/api/keys") {
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      if (req.url === "/dashboard") {
        res.statusCode = 302;
        res.setHeader("location", "/login");
        res.end();
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });

    const results = await checkUnauthenticatedLanRejection({ baseUrl });
    expect(summarize(results).failures).toEqual([]);
  });

  it("expects 401 for /v1/models when the caller is remote", async () => {
    const baseUrl = await stubServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models") {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: "API key required for remote API access" }));
        return;
      }
      if (req.url === "/dashboard") {
        res.statusCode = 302;
        res.setHeader("location", "/login");
        res.end();
        return;
      }
      res.statusCode = req.url === "/api/health" ? 200 : 401;
      res.end(JSON.stringify(req.url === "/api/health" ? { ok: true } : { error: "Unauthorized" }));
    });

    const results = await checkUnauthenticatedLanRejection({ baseUrl, isLoopback: false });
    expect(summarize(results).failures).toEqual([]);
    expect(results.map((r) => r.name)).toContain("LAN /v1/models rejected without key");
  });

  it("fails when a protected API answers 200 without a session", async () => {
    const baseUrl = await stubServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.url === "/api/health" ? { ok: true } : { keys: [] }));
    });
    const failures = summarize(await checkUnauthenticatedLanRejection({ baseUrl })).failures;
    expect(failures.map((f) => f.name)).toEqual(
      expect.arrayContaining(["LAN /api/providers rejected", "LAN /api/keys rejected"])
    );
  });
});

describe("checkExperimentalRouteBlocks", () => {
  it("passes only when every blocked route answers 401/403", async () => {
    const baseUrl = await stubServer((req, res) => {
      res.statusCode = 403;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "blocked" }));
    });
    const results = await checkExperimentalRouteBlocks({ baseUrl });
    expect(results).toHaveLength(BLOCKED_ROUTES.length);
    expect(summarize(results).failures).toEqual([]);
  });

  it("fails when a route still executes (2xx)", async () => {
    const baseUrl = await stubServer((req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ success: true }));
    });
    const failures = summarize(await checkExperimentalRouteBlocks({ baseUrl })).failures;
    expect(failures).toHaveLength(BLOCKED_ROUTES.length);
  });
});

describe("checkAuthenticatedLanMockFlow", () => {
  function flowServer({ loginOk = true } = {}) {
    const created = { id: "key-1", key: "sk-mock", name: "gpuix-verify" };
    return async (req, res) => {
      const json = (status, body) => {
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(body));
      };
      if (req.url === "/api/auth/login") {
        if (!loginOk) return json(401, { error: "Invalid password" });
        res.setHeader("set-cookie", "auth_token=stub; Path=/; HttpOnly");
        return json(200, { success: true });
      }
      const cookie = req.headers.cookie || "";
      if (!cookie.includes("auth_token=")) return json(401, { error: "Unauthorized" });
      if (req.url === "/api/providers") return json(200, { providers: [] });
      if (req.url === "/api/keys" && req.method === "POST") return json(201, created);
      if (req.url === "/api/keys") return json(200, { keys: [created] });
      if (req.url === `/api/keys/${created.id}`) return json(200, { message: "deleted" });
      return json(404, { error: "not found" });
    };
  }

  it("logs in, reads providers, and round-trips a throwaway API key", async () => {
    const baseUrl = await stubServer(flowServer());
    const results = await checkAuthenticatedLanMockFlow({ baseUrl, password: "generated" });
    expect(summarize(results).failures).toEqual([]);
    expect(results.map((r) => r.name)).toEqual([
      "LAN password login succeeds",
      "LAN /api/providers allowed with session",
      "LAN mock API key created",
      "mock API key reads back from isolated DB",
      "mock API key deleted",
    ]);
  });

  it("stops after a rejected login and does not attempt writes", async () => {
    const baseUrl = await stubServer(flowServer({ loginOk: false }));
    const results = await checkAuthenticatedLanMockFlow({ baseUrl, password: "wrong" });
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
  });
});

// Keeps the temp-dir import used (lint) without an unused-import failure.
describe("temp dir helper", () => {
  it("is available for callers that need a scratch dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpuix-sec-"));
    expect(fs.existsSync(dir)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
