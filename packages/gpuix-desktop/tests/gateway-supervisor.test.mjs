import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  GatewaySupervisor,
  isPortBusy,
  isPortOwnedByOther,
  netstatOwners,
  probePortOwnership,
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

function healthScript(host) {
  return `
    const http = require("node:http");
    http.createServer((req, res) => {
      if (req.url === "/api/health") { res.writeHead(200, {"content-type":"application/json"}); res.end('{"ok":true}'); return; }
      res.writeHead(404).end();
    }).listen(Number(process.env.PORT), ${JSON.stringify(host)});
  `;
}

async function freePort() {
  const server = net.createServer().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}

async function occupiedPort() {
  const server = net.createServer().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address();
  cleanups.push(() => new Promise((r) => server.close(r)));
  return port;
}

// One fresh TCP request per call: undici's fetch reuses pooled sockets, which
// makes a displacement test read the old listener's response instead of the
// new owner's. Raw net.connect always opens a new connection.
function rawHttpGet(port, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port, host });
    let data = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    });
    socket.on("data", (chunk) => {
      data += chunk;
    });
    socket.once("end", () => resolve(data));
    socket.once("error", reject);
  });
}

function netstatRowsOnPort(port) {
  return new Promise((resolve) => {
    const netstat = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "netstat.exe");
    execFile(netstat, ["-ano"], { timeout: 5000, windowsHide: true }, (error, output) => {
      if (error) return resolve([]);
      resolve(
        String(output)
          .split(/\r?\n/)
          .filter((line) => /^\s*TCP\s/i.test(line))
          .map((line) => line.trim().split(/\s+/))
          .filter((fields) => fields.length === 5 && fields[1].endsWith(`:${port}`))
      );
    });
  });
}

// Kernel-held rows (TIME_WAIT etc.) have PID 0 and a real peer port. The state
// text is localized, so look for those two facts instead of the literal word.
function kernelPeerRow(rows, port) {
  return rows.filter((fields) => fields[4] === "0" && fields[1].endsWith(`:${port}`) && !fields[2].endsWith(":0"));
}

async function waitForKernelPeerRow(port) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const rows = await netstatRowsOnPort(port);
    if (kernelPeerRow(rows, port).length > 0) return rows;
    await new Promise((r) => setTimeout(r, 40));
  }
  return [];
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

describe("port ownership probe", () => {
  it.skipIf(process.platform !== "win32")("ignores TIME_WAIT rows left by our own closed connections", async () => {
    // Server-side close first, client FIN second: the server becomes the
    // active closer, which leaves a "127.0.0.1:P -> 127.0.0.1:q TIME_WAIT 0"
    // row while the listener still exists. (Node's HTTP keepAliveTimeout did
    // not close the idle socket on Node 24.22.1/Windows within 500 ms, so the
    // close is explicit here.)
    const server = net.createServer((socket) => socket.end());
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "0.0.0.0", resolve);
    });
    const port = server.address().port;
    let listening = true;
    cleanups.push(
      () =>
        new Promise((resolve) => {
          if (!listening) return resolve();
          listening = false;
          server.close(resolve);
        })
    );

    const client = net.connect({ port, host: "127.0.0.1" });
    cleanups.push(() => client.destroy());
    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    });
    await new Promise((resolve) => client.once("end", resolve));
    client.destroy();

    const rows = await waitForKernelPeerRow(port);
    const kernelRows = kernelPeerRow(rows, port);
    expect(kernelRows.length).toBeGreaterThan(0);
    // The row is the kernel's, not a process's: PID 0 must not read as owner.
    expect(kernelRows.every((fields) => fields[4] === "0")).toBe(true);

    const ownPid = process.pid;
    expect(await isPortOwnedByOther(port, ownPid)).toBe(false);
    expect(await isPortBusy(port, "0.0.0.0", 5000, ownPid)).toBe(false);
    expect(await probePortOwnership(port, { exceptPid: ownPid })).toEqual({ state: "free", owners: [] });

    // Restart path: the listener is gone but the kernel row remains, so the
    // plain startup preflight must not report the port as occupied.
    await new Promise((resolve) => {
      listening = false;
      server.close(resolve);
    });
    expect(kernelPeerRow(await netstatRowsOnPort(port), port).length).toBeGreaterThan(0);
    expect(await isPortBusy(port)).toBe(false);
  });
});

// Fixtures are real netstat -ano shapes (Windows pads columns with spaces). The
// state column is localized on purpose; classification must not depend on it.
describe("netstatOwners", () => {
  const PORT = 20129;
  const rows = (...lines) => lines.join("\r\n");

  it("classifies an en-US LISTENING listener by its no-peer endpoint", () => {
    const output = rows("  TCP    0.0.0.0:20129          0.0.0.0:0              LISTENING       4242");
    expect([...netstatOwners(output, PORT)]).toEqual([4242]);
  });

  it("classifies a German ABHÖREN listener identically", () => {
    const output = rows("  TCP    0.0.0.0:20129          0.0.0.0:0              ABHÖREN         4242");
    expect([...netstatOwners(output, PORT)]).toEqual([4242]);
  });

  it("classifies a listener whose state text is unrecognized", () => {
    const output = rows("  TCP    127.0.0.1:20129        0.0.0.0:0              UNBEKANNT       4242");
    expect([...netstatOwners(output, PORT)]).toEqual([4242]);
  });

  it("treats an IPv6 [::] listener as an owner", () => {
    const output = rows("  TCP    [::]:20129             [::]:0                 LISTENING       4242");
    expect([...netstatOwners(output, PORT)]).toEqual([4242]);
  });

  it("ignores TIME_WAIT rows held by the kernel (PID 0)", () => {
    const output = rows("  TCP    127.0.0.1:20129        127.0.0.1:50999        TIME_WAIT       0");
    expect([...netstatOwners(output, PORT)]).toEqual([]);
  });

  it("exempts our own child's ESTABLISHED rows and LISTENING row", () => {
    const output = rows(
      "  TCP    0.0.0.0:20129          0.0.0.0:0              LISTENING       4242",
      "  TCP    127.0.0.1:20129        127.0.0.1:50998        ESTABLISHED     4242"
    );
    expect([...netstatOwners(output, PORT, { exceptPid: 4242 })]).toEqual([]);
  });

  it("ignores an ESTABLISHED row owned by an unrelated PID (has a peer)", () => {
    const output = rows("  TCP    127.0.0.1:20129        127.0.0.1:50997        ESTABLISHED     7777");
    expect([...netstatOwners(output, PORT)]).toEqual([]);
  });

  it("reports a foreign listener with a different PID", () => {
    const output = rows(
      "  TCP    0.0.0.0:20129          0.0.0.0:0              LISTENING       4242",
      "  TCP    127.0.0.1:20129        0.0.0.0:0              LISTENING       7777"
    );
    expect([...netstatOwners(output, PORT, { exceptPid: 4242 })]).toEqual([7777]);
  });

  it("ignores malformed rows, non-TCP rows and other ports", () => {
    const output = rows(
      "  UDP    0.0.0.0:20129          *:*                                    4242",
      "  TCP    0.0.0.0:20129          0.0.0.0:0              LISTENING",
      "  TCP    0.0.0.0:20130          0.0.0.0:0              LISTENING       4242",
      "garbage"
    );
    expect([...netstatOwners(output, PORT)]).toEqual([]);
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

  it("stops the gateway after two consecutive foreign-owner confirmations", async () => {
    const dir = tempDir();
    fakeNodeScript(dir, healthScript("0.0.0.0"));
    const port = await freePort();
    let checks = 0;
    let supervisor;
    const lost = new Promise((resolve) => {
      supervisor = new GatewaySupervisor({
        runtimeDir: dir,
        port,
        logDir: tempDir(),
        secrets: {},
        env: { ...process.env, PORT: String(port) },
        healthTimeoutMs: 10_000,
        portMonitorMs: 40,
        // Start-time ownership checks use portOwnedByOther; the monitor uses
        // the tri-state probe. Every probe reports a foreign listener, so the
        // second confirmation must tear the gateway down.
        portProbe: async () => {
          checks++;
          return { state: "busy", owners: [424242] };
        },
        onPortLost: resolve,
      });
      cleanups.push(() => supervisor.stop());
    });
    await supervisor.start();
    expect(supervisor.isRunning()).toBe(true);
    const pid = supervisor.child.pid;
    const error = await lost;
    expect(error).toBeInstanceOf(PortConflictError);
    expect(checks).toBe(2);
    expect(supervisor.isRunning()).toBe(false);
    expect(() => process.kill(pid, 0)).toThrow();
  }, 30_000);

  it("does not stop on one busy tick, an inconclusive probe, or a single confirmation", async () => {
    const dir = tempDir();
    fakeNodeScript(dir, healthScript("0.0.0.0"));
    const port = await freePort();
    // busy, free (resets), unknown (neutral), busy, busy -> one confirmation
    // is not enough, and neither an error nor a lone busy tick may shut down.
    const states = ["busy", "free", "unknown", "busy", "busy"];
    let calls = 0;
    let supervisor;
    const lost = new Promise((resolve) => {
      supervisor = new GatewaySupervisor({
        runtimeDir: dir,
        port,
        logDir: tempDir(),
        secrets: {},
        env: { ...process.env, PORT: String(port) },
        healthTimeoutMs: 10_000,
        portMonitorMs: 30,
        portProbe: async () => {
          const state = states[Math.min(calls, states.length - 1)];
          calls++;
          if (calls === 3) throw new Error("netstat timed out");
          return { state, owners: [] };
        },
        onPortLost: resolve,
      });
      cleanups.push(() => supervisor.stop());
    });
    await supervisor.start();
    const error = await lost;
    expect(error).toBeInstanceOf(PortConflictError);
    // The gateway stays up through the first four probes and only the fifth
    // (second adjacent confirmation) triggers the shutdown.
    expect(calls).toBeGreaterThanOrEqual(5);
    await new Promise((r) => setTimeout(r, 120));
    expect(supervisor.isRunning()).toBe(false);
  }, 30_000);

  it.skipIf(process.platform !== "win32")("fails closed when a foreign listener binds the port after startup", async () => {
    const dir = tempDir();
    fakeNodeScript(dir, healthScript("0.0.0.0"));
    const port = await freePort();
    let supervisor;
    const lost = new Promise((resolve) => {
      supervisor = new GatewaySupervisor({
        runtimeDir: dir,
        port,
        logDir: tempDir(),
        secrets: {},
        env: { ...process.env, PORT: String(port) },
        healthTimeoutMs: 10_000,
        portMonitorMs: 100,
        onPortLost: resolve,
      });
      cleanups.push(() => supervisor.stop());
    });
    await supervisor.start();
    expect(supervisor.isRunning()).toBe(true);
    const pid = supervisor.child.pid;

    // Windows allows this bind even though our child already holds 0.0.0.0,
    // and this listener then answers loopback requests instead of the child.
    const foreign = createServer((_req, res) => res.writeHead(200, { "content-type": "text/plain" }).end("foreign"));
    await new Promise((resolve, reject) => {
      foreign.once("error", reject);
      foreign.listen(port, "127.0.0.1", resolve);
    });
    cleanups.push(() => new Promise((resolve) => foreign.close(resolve)));

    // Prove the displacement, not just that a second listener exists: a fresh
    // unpooled connection to loopback must reach the foreign body. fetch would
    // reuse undici's pooled socket and read the child's old response.
    const body = await rawHttpGet(port);
    expect(body).toMatch(/^HTTP\/1\.1 200/);
    expect(body).toContain("foreign");

    const error = await lost;
    expect(error).toBeInstanceOf(PortConflictError);
    expect(supervisor.isRunning()).toBe(false);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(foreign.listening).toBe(true);
  }, 30_000);

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

describe("stop teardown", () => {
  it("forces completion without reporting port loss when the child never emits exit", async () => {
    const dir = tempDir();
    fakeNodeScript(dir, "// never spawned");
    const notifications = [];
    const supervisor = new GatewaySupervisor({
      runtimeDir: dir,
      port: 1,
      logDir: tempDir(),
      secrets: {},
      env: {},
      stopGraceMs: 40,
      onPortLost: (error) => notifications.push(error),
    });
    const child = new EventEmitter();
    child.pid = 123456;
    child.kill = () => true; // accepts both SIGTERM and SIGKILL, never exits
    supervisor.child = child;

    const first = supervisor.stop();
    expect(supervisor.stop()).toBe(first);
    await first;

    // A forced teardown is not a port loss: intentional quits must stay clean.
    expect(notifications).toEqual([]);

    // Completion is idempotent: later calls neither hang nor notify.
    await supervisor.stop();
    expect(notifications).toEqual([]);
  });

  it("does not report port loss on an intentional stop of a real gateway", async () => {
    const dir = tempDir();
    fakeNodeScript(dir, healthScript("0.0.0.0"));
    const port = await freePort();
    const notifications = [];
    const supervisor = new GatewaySupervisor({
      runtimeDir: dir,
      port,
      logDir: tempDir(),
      secrets: {},
      env: { ...process.env, PORT: String(port) },
      healthTimeoutMs: 10_000,
      portMonitorMs: 20,
      onPortLost: (error) => notifications.push(error),
    });
    cleanups.push(() => supervisor.stop());

    await supervisor.start();
    await supervisor.stop();
    await new Promise((r) => setTimeout(r, 120));

    expect(supervisor.isRunning()).toBe(false);
    expect(notifications).toEqual([]);
  }, 30_000);

  it("reports one PortConflictError when the monitor's teardown is forced", async () => {
    const dir = tempDir();
    fakeNodeScript(dir, "// never spawned");
    const notifications = [];
    const supervisor = new GatewaySupervisor({
      runtimeDir: dir,
      port: 1,
      logDir: tempDir(),
      secrets: {},
      env: {},
      portMonitorMs: 20,
      portLossConfirmations: 2,
      stopGraceMs: 30,
      portProbe: async () => ({ state: "busy", owners: [777] }),
      onPortLost: (error) => notifications.push(error),
    });
    const child = new EventEmitter();
    child.pid = 123456;
    child.kill = () => true; // never emits exit, so the monitor's stop is forced
    supervisor.child = child;
    supervisor.startPortMonitor();

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("monitor never reported the loss")), 5000);
      const poll = setInterval(() => {
        if (!notifications.length) return;
        clearInterval(poll);
        clearTimeout(timer);
        resolve();
      }, 20);
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toBeInstanceOf(PortConflictError);

    await supervisor.stop();
    await new Promise((r) => setTimeout(r, 100));
    expect(notifications).toHaveLength(1);
  });
});
