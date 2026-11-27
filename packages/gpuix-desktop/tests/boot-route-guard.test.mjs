// Boot-time enforcement of the experimental route guard.
//
// `boot()` must prove against the running gateway (not just the staged marker
// files) that the self-update and cross-process kill routes refuse unauthenticated
// POSTs. The fake runtime lets the test serve those routes with any status, so
// both the fail-closed and the explicit opt-out paths are proven end to end.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { boot } from "../src/main.mjs";
import { IsolationError } from "../src/config.mjs";
import { isPortBusy } from "../src/gateway-supervisor.mjs";

const cleanups = [];

afterEach(async () => {
  // Reverse order: stop supervisors before their temp dirs are removed.
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function freePort() {
  const server = net.createServer().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}

const GUARD_FILES = [
  "middleware.js",
  "app/api/version/update/route.js",
  "app/api/version/shutdown/route.js",
  "app/api/shutdown/route.js",
];

// A minimal staged runtime: the marker files the pre-check greps, plus a
// gateway that answers health/version and blocks (or not) the guarded routes.
function stageRuntime({ blockedStatus }) {
  const dir = tempDir("gpuix-boot-runtime-");
  fs.writeFileSync(
    path.join(dir, "custom-server.js"),
    `
    const http = require("node:http");
    const blocked = new Set(["/api/version/update", "/api/version/shutdown", "/api/shutdown"]);
    http.createServer((req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
        return;
      }
      if (req.url === "/api/version") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"currentVersion":"test"}');
        return;
      }
      if (req.method === "POST" && blocked.has(req.url)) {
        res.writeHead(${blockedStatus}, { "content-type": "application/json" });
        res.end('{"error":"blocked"}');
        return;
      }
      res.writeHead(404).end();
    }).listen(Number(process.env.PORT), "0.0.0.0");
    `
  );
  const serverDir = path.join(dir, "desktop-dist", "server");
  for (const file of GUARD_FILES) {
    const full = path.join(serverDir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "// Disabled in the experimental desktop build\n// NINEROUTER_GPU_UIX\n");
  }
  return dir;
}

function bootEnv(runtimeDir, port) {
  return {
    ...process.env,
    APPDATA: tempDir("gpuix-boot-appdata-"),
    LOCALAPPDATA: tempDir("gpuix-boot-localappdata-"),
    GPU_UIX_GATEWAY_RUNTIME: runtimeDir,
    NINEROUTER_GPU_UIX_PORT: String(port),
  };
}

async function bootAndTrack(env, options = {}) {
  const session = await boot({ env, headless: true, ...options });
  cleanups.push(() => session.supervisor.stop());
  return session;
}

describe("boot route guard", () => {
  it("fails closed and stops the gateway when a guarded route answers 200", async () => {
    const runtimeDir = stageRuntime({ blockedStatus: 200 });
    const port = await freePort();
    const env = bootEnv(runtimeDir, port);

    const error = await boot({ env, headless: true }).catch((e) => e);
    expect(error).toBeInstanceOf(IsolationError);
    expect(error.message).toMatch(/route guard failed/i);
    expect(error.details.failures).toHaveLength(3);
    expect(error.details.failures.every((f) => f.status === 200)).toBe(true);

    // The gateway started for the guard and must be torn down on failure.
    // netstat can lag a moment behind process exit, so poll briefly.
    let busy = true;
    for (let attempt = 0; attempt < 20 && busy; attempt++) {
      busy = await isPortBusy(port);
      if (busy) await new Promise((r) => setTimeout(r, 50));
    }
    expect(busy).toBe(false);
  }, 40_000);

  it("boots when every guarded route refuses the POST", async () => {
    const runtimeDir = stageRuntime({ blockedStatus: 403 });
    const port = await freePort();
    const session = await bootAndTrack(bootEnv(runtimeDir, port));

    expect(session.supervisor.isRunning()).toBe(true);
    expect(session.status.phase).toBe("ready");
  }, 40_000);

  it("skips the live probe only behind the explicit option", async () => {
    // The fake-runtime harness cannot serve the real Next.js routes; the
    // opt-out must be requested deliberately and still rely on the marker
    // pre-check (which passed for this runtime).
    const runtimeDir = stageRuntime({ blockedStatus: 200 });
    const port = await freePort();
    const session = await bootAndTrack(bootEnv(runtimeDir, port), { verifyBlockedRoutes: false });

    expect(session.supervisor.isRunning()).toBe(true);
    expect(session.status.phase).toBe("ready");
  }, 40_000);
});
