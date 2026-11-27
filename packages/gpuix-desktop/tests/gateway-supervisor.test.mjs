import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  GatewaySupervisor,
  isPortBusy,
  resolveRuntimeDir,
  waitForHealth,
} from "../src/gateway-supervisor.mjs";
import { PortConflictError, IsolationError } from "../src/config.mjs";

const cleanups = [];

afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

function fakeNodeScript(dir, source) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "custom-server.js");
  fs.writeFileSync(file, source);
  return dir;
}

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpuix-gw-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function occupiedPort() {
  const server = net.createServer().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address();
  cleanups.push(() => new Promise((r) => server.close(r)));
  return port;
}

describe("isPortBusy", () => {
  it("reports a listener as busy and a closed port as free", async () => {
    const busy = await occupiedPort();
    expect(await isPortBusy(busy)).toBe(true);
    const freeServer = net.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => freeServer.once("listening", r));
    const free = freeServer.address().port;
    await new Promise((r) => freeServer.close(r));
    expect(await isPortBusy(free)).toBe(false);
  });

  it("detects a listener on another loopback address", async () => {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.2", resolve);
    });
    cleanups.push(() => new Promise((resolve) => server.close(resolve)));
    expect(await isPortBusy(server.address().port)).toBe(true);
  });
});

describe("waitForHealth", () => {
  it("succeeds against a real HTTP health endpoint", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    cleanups.push(() => new Promise((r) => server.close(r)));
    const { port } = server.address();
    await expect(waitForHealth({ port, deadline: Date.now() + 5000 })).resolves.toEqual({ ok: true });
  });

  it("times out when the endpoint never becomes healthy", async () => {
    const server = createServer((_req, res) => res.writeHead(503).end("nope"));
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    cleanups.push(() => new Promise((r) => server.close(r)));
    const { port } = server.address();
    await expect(waitForHealth({ port, deadline: Date.now() + 900, intervalMs: 100 })).rejects.toThrow(
      /did not become healthy/
    );
  });
});

describe("resolveRuntimeDir", () => {
  it("finds a runtime that contains custom-server.js", () => {
    const dir = tempDir();
    fakeNodeScript(dir, "// noop");
    expect(resolveRuntimeDir({ env: { GPU_UIX_GATEWAY_RUNTIME: dir }, packageRoot: dir })).toBe(path.resolve(dir));
  });

  it("throws a descriptive error when no runtime is staged", () => {
    const dir = tempDir();
    expect(() => resolveRuntimeDir({ env: {}, packageRoot: path.join(dir, "pkg") })).toThrow(IsolationError);
  });
});

describe("GatewaySupervisor", () => {
  function supervisorFor(runtimeDir, port, logDir) {
    const supervisor = new GatewaySupervisor({
      runtimeDir,
      port,
      logDir,
      secrets: { initialPassword: "p", jwtSecret: "j", apiKeySecret: "a", machineIdSalt: "m" },
      env: { ...process.env, PORT: String(port), DATA_DIR: path.join(logDir, "data") },
      healthTimeoutMs: 15_000,
    });
    cleanups.push(() => supervisor.stop());
    return supervisor;
  }

  it("refuses an occupied port instead of taking it over", async () => {
    const port = await occupiedPort();
    const dir = tempDir();
    fakeNodeScript(dir, "// never started");
    const supervisor = supervisorFor(dir, port, tempDir());
    await expect(supervisor.start()).rejects.toBeInstanceOf(PortConflictError);
    expect(supervisor.isRunning()).toBe(false);
  });

  it("does not probe a foreign listener that wins the bind race", async () => {
    let requests = 0;
    const occupant = createServer((_req, res) => {
      requests++;
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    });
    await new Promise((resolve) => occupant.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise((resolve) => occupant.close(resolve)));
    const port = occupant.address().port;
    const dir = tempDir();
    fakeNodeScript(dir, 'require("node:http").createServer().listen(Number(process.env.PORT), "127.0.0.1");');
    const supervisor = new GatewaySupervisor({
      runtimeDir: dir,
      port,
      logDir: tempDir(),
      secrets: {},
      env: { ...process.env, PORT: String(port) },
      healthTimeoutMs: 3000,
      portIsBusy: async () => false,
    });
    cleanups.push(() => supervisor.stop());
    await expect(supervisor.start()).rejects.toThrow();
    expect(requests).toBe(0);
    expect(occupant.listening).toBe(true);
  }, 15000);

  it.skipIf(process.platform !== "win32")("rejects overlapping wildcard binds before health probing", async () => {
    let requests = 0;
    const occupant = createServer((_req, res) => {
      requests++;
      res.writeHead(200).end();
    });
    await new Promise((resolve, reject) => {
      occupant.once("error", reject);
      occupant.listen(0, "127.0.0.2", resolve);
    });
    cleanups.push(() => new Promise((resolve) => occupant.close(resolve)));
    const port = occupant.address().port;
    const dir = tempDir();
    fakeNodeScript(dir, 'require("node:http").createServer().listen(Number(process.env.PORT), "0.0.0.0");');
    const supervisor = new GatewaySupervisor({
      runtimeDir: dir,
      port,
      logDir: tempDir(),
      secrets: {},
      env: { ...process.env, PORT: String(port) },
      healthTimeoutMs: 3000,
      portIsBusy: async () => false,
    });
    cleanups.push(() => supervisor.stop());
    await expect(supervisor.start()).rejects.toBeInstanceOf(PortConflictError);
    expect(requests).toBe(0);
    expect(occupant.listening).toBe(true);
  }, 15000);

  it("starts a real child, becomes healthy, and stops without orphans", async () => {
    const dir = tempDir();
    const script = `
      const http = require("node:http");
      const port = Number(process.env.PORT);
      http.createServer((req, res) => {
        if (req.url === "/api/health") { res.writeHead(200, {"content-type":"application/json"}); res.end('{"ok":true}'); return; }
        res.writeHead(404).end();
      }).listen(port, "127.0.0.1");
    `;
    fakeNodeScript(dir, script);
    const freeServer = net.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => freeServer.once("listening", r));
    const port = freeServer.address().port;
    await new Promise((r) => freeServer.close(r));

    const logDir = tempDir();
    const supervisor = supervisorFor(dir, port, logDir);
    const health = await supervisor.start();
    expect(health).toEqual({ ok: true });
    expect(supervisor.isRunning()).toBe(true);
    const pid = supervisor.child.pid;
    expect(fs.existsSync(path.join(logDir, "gateway.log"))).toBe(true);

    await supervisor.stop();
    expect(supervisor.isRunning()).toBe(false);
    expect(() => process.kill(pid, 0)).toThrow();
  }, 40_000);

  it("kills the child when health never arrives", async () => {
    const dir = tempDir();
    fakeNodeScript(dir, "setInterval(() => {}, 1000);");
    const freeServer = net.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => freeServer.once("listening", r));
    const port = freeServer.address().port;
    await new Promise((r) => freeServer.close(r));

    const supervisor = new GatewaySupervisor({
      runtimeDir: dir,
      port,
      logDir: tempDir(),
      secrets: { initialPassword: "p", jwtSecret: "j", apiKeySecret: "a", machineIdSalt: "m" },
      env: { ...process.env, PORT: String(port) },
      healthTimeoutMs: 1200,
    });
    cleanups.push(() => supervisor.stop());
    await expect(supervisor.start()).rejects.toThrow(/did not become healthy/);
    expect(supervisor.isRunning()).toBe(false);
  }, 30_000);

  it("stops the child when the host exits without awaiting teardown", async () => {
    const dir = tempDir();
    fakeNodeScript(
      dir,
      `
      const http = require("node:http");
      const port = Number(process.env.PORT);
      http.createServer((req, res) => {
        if (req.url === "/api/health") { res.writeHead(200); res.end('{"ok":true}'); return; }
        res.writeHead(404).end();
      }).listen(port, "127.0.0.1");
      console.log("child-pid:" + process.pid);
    `
    );
    const freeServer = net.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => freeServer.once("listening", r));
    const port = freeServer.address().port;
    await new Promise((r) => freeServer.close(r));

    const supervisor = new GatewaySupervisor({
      runtimeDir: dir,
      port,
      logDir: tempDir(),
      secrets: { initialPassword: "p", jwtSecret: "j", apiKeySecret: "a", machineIdSalt: "m" },
      env: { ...process.env, PORT: String(port) },
      healthTimeoutMs: 15_000,
    });
    cleanups.push(() => supervisor.stop());
    await supervisor.start();
    const pid = supervisor.child.pid;
    supervisor.installExitGuard();

    // Emit the same "exit" event process.exit() produces, without killing the
    // test process, and prove the gateway is torn down.
    process.emit("exit", 0);
    await new Promise((r) => setTimeout(r, 1500));
    expect(() => process.kill(pid, 0)).toThrow();
  }, 40_000);
});
