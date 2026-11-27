// Supervises the bundled Node gateway as a child process.
//
// The shell owns the gateway lifetime: it spawns it with an isolated DATA_DIR,
// waits for /api/health, and guarantees teardown on quit or crash so no orphan
// gateway keeps a LAN port open. An occupied port is a hard stop, not an
// invitation to pick another port silently.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { IsolationError, PortConflictError } from "./config.mjs";
import { redactSecrets } from "./secrets.mjs";

// Windows netstat keeps TIME_WAIT rows for connections the server closed, and
// those rows carry PID 0. They are not owners: no process is listening, the
// kernel is only holding the 4-tuple so a late packet cannot be misdelivered.
//
// The state column is localized ("LISTENING" is German "ABHÖREN", etc.), so it
// is never parsed. A listener is recognized by its peer endpoint instead: a
// listening socket has no peer and Windows prints that as "0.0.0.0:0" or
// "[::]:0". Accepted/established/TIME_WAIT rows always carry a real peer port,
// so they cannot be mistaken for a listener. Equivalently: skip PID 0 (kernel
// rows), then any remaining non-zero PID holding the local port is an owner;
// our own child's server-side ESTABLISHED rows are excluded via `exceptPid`.
//
// A malformed row proves nothing about the port and is skipped instead of
// failing the whole probe.
const NETSTAT_TCP_PREFIX = /^\s*TCP\s/i;

export function netstatOwners(output, port, { exceptPid = null } = {}) {
  const owners = new Set();
  for (const line of String(output).split(/\r?\n/)) {
    if (!NETSTAT_TCP_PREFIX.test(line)) continue;
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 5) continue;
    const [, local, peer, , pidField] = fields;
    const localPort = /:(\d+)$/.exec(local || "");
    if (!localPort || Number(localPort[1]) !== port) continue;
    // ":0" means no peer port, i.e. a listening socket. Locale-proof: the
    // localized state text plays no part in the decision.
    if (!String(peer).endsWith(":0")) continue;
    if (!/^\d+$/.test(pidField)) continue;
    const pid = Number(pidField);
    if (pid === 0) continue;
    if (pid === exceptPid) continue;
    owners.add(pid);
  }
  return owners;
}

// Tri-state probe used by the ownership monitor.
//   "free"    no foreign listener at the probe instant
//   "busy"    at least one foreign listener (non-zero PID, no peer endpoint)
//   "unknown" netstat could not answer (exec error or timeout)
// Only "busy" may be treated as evidence of loss. "unknown" is exactly that,
// unknown, and must never move the monitor towards a shutdown.
export function probePortOwnership(port, { exceptPid = null, timeoutMs = 5000 } = {}) {
  if (process.platform !== "win32") return Promise.resolve({ state: "free", owners: [] });
  const netstat = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "netstat.exe");
  return new Promise((resolve) => {
    execFile(netstat, ["-ano"], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, output) => {
      if (error) return resolve({ state: "unknown", owners: [], error });
      const owners = [...netstatOwners(String(output), port, { exceptPid })];
      return resolve(owners.length ? { state: "busy", owners } : { state: "free", owners: [] });
    });
  });
}

export async function isPortBusy(port, host = "0.0.0.0", timeoutMs = 5000, exceptPid = null) {
  if (process.platform === "win32") {
    const probe = await probePortOwnership(port, { exceptPid, timeoutMs });
    // Boot-time checks stay fail-closed: an unanswered probe is treated as
    // occupied rather than as a free port, because accepting a port that
    // another process may be intercepting is worse than refusing to start.
    return probe.state !== "free";
  }
  return new Promise((resolve) => {
    const server = net.createServer();
    let finished = false;
    const timer = setTimeout(() => done(true), timeoutMs);
    const done = (busy) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (server.listening) server.close(() => resolve(busy));
      else resolve(busy);
    };
    server.once("error", () => done(true));
    server.once("listening", () => {
      if (finished) server.close();
      else done(false);
    });
    server.listen({ port, host, exclusive: true });
  });
}

// Windows lets a wildcard bind and a specific-address bind share one port, and
// the more specific listener takes the traffic. A foreign 127.0.0.1 listener
// created after our 0.0.0.0 listener therefore receives every loopback request
// while our socket stays "healthy" (verified on Windows with Node 24.22.1;
// Node's `exclusive` listen option does not prevent it). `isPortBusy` with an
// owner PID proves that no other process holds the port at the probe instant.
// Only listener rows count (see `netstatOwners`), so the TIME_WAIT rows our
// own closed connections leave behind are not misread as an intruder.
// Boot-time ownership checks fail closed on an unanswered probe; the periodic
// monitor uses `probePortOwnership` directly so it can treat that case as a
// neutral tick instead. The check is Windows-only: it is the platform this
// experiment targets.
export async function isPortOwnedByOther(port, pid, timeoutMs = 5000) {
  if (process.platform !== "win32") return false;
  const probe = await probePortOwnership(port, { exceptPid: pid, timeoutMs });
  return probe.state !== "free";
}

export function resolveRuntimeDir({ env = process.env, packageRoot } = {}) {
  const candidates = [];
  if (env.GPU_UIX_GATEWAY_RUNTIME) candidates.push(env.GPU_UIX_GATEWAY_RUNTIME);
  // Packaged: resources/gateway next to the executable.
  candidates.push(path.join(packageRoot, "resources", "gateway"));
  // Repository development: the Electron staging output, which is exactly the
  // Next standalone tree the installed app ships.
  candidates.push(path.join(packageRoot, "..", "..", "desktop-app", "runtime"));
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(path.join(resolved, "custom-server.js"))) return resolved;
  }
  throw new IsolationError(
    `No gateway runtime found. Looked in: ${candidates.map((c) => path.resolve(c)).join(", ")}. Run "npm run desktop:stage" at the repository root first.`,
    { candidates }
  );
}

function createLogger(logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const file = path.join(logDir, "gateway.log");
  let pending = "";
  const write = (line) => {
    pending += line;
    if (pending.length < 8192 && !line.includes("\n")) return;
    try {
      fs.appendFileSync(file, pending);
    } catch {
      // Logging must never take down the shell.
    }
    pending = "";
  };
  return {
    file,
    log(...parts) {
      write(`${new Date().toISOString()} ${parts.join(" ")}\n`);
    },
    close() {
      if (pending) write("");
    },
  };
}

export async function waitForHealth({ port, deadline, fetchImpl = fetch, intervalMs = 300 }) {
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetchImpl(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const body = await res.json();
        if (body && body.ok === true) return body;
        lastError = new Error(`/api/health returned ${JSON.stringify(body)}`);
      } else {
        lastError = new Error(`/api/health status ${res.status}`);
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Gateway did not become healthy on port ${port} within the timeout${lastError ? `: ${lastError.message}` : ""}.`
  );
}

export class GatewaySupervisor {
  constructor({
    runtimeDir, env, port, logDir, secrets, nodePath = process.execPath,
    healthTimeoutMs = 90_000, portIsBusy = isPortBusy,
    portOwnedByOther = isPortOwnedByOther, portProbe = probePortOwnership,
    portMonitorMs = 1500, portProbeTimeoutMs = 2000,
    portLossConfirmations = 2, onPortLost = null,
    stopGraceMs = 5000,
  }) {
    this.runtimeDir = runtimeDir;
    this.env = env;
    this.port = port;
    this.secrets = secrets;
    this.nodePath = nodePath;
    this.healthTimeoutMs = healthTimeoutMs;
    this.portIsBusy = portIsBusy;
    this.portOwnedByOther = portOwnedByOther;
    this.portProbe = portProbe;
    this.portMonitorMs = portMonitorMs;
    // Detection budget, no behavior: with a prompt netstat (~23 ms) two 1.5 s
    // confirmations plus stop take ~3.0-3.2 s. A slow-but-successful probe
    // (1.5-2 s) can push the two confirmations ~3 s apart, stretching the
    // worst case to ~6.8 s. If netstat fails or exceeds the 2 s probe timeout
    // the tick is "unknown" and the runtime monitor is fail-open by design
    // (boot checks stay fail-closed).
    this.portProbeTimeoutMs = portProbeTimeoutMs;
    // One netstat sample is not enough: a single transient or misparsed row
    // must not tear down a healthy gateway. Two consecutive "busy" probes do.
    this.portLossConfirmations = Math.max(1, portLossConfirmations);
    this.portLossStreak = 0;
    this.onPortLost = onPortLost;
    this.portLostNotified = false;
    this.portMonitor = null;
    this.portCheckInFlight = false;
    this.portLost = false;
    this.stopPromise = null;
    this.stopGraceMs = stopGraceMs;
    this.logger = createLogger(logDir);
    this.child = null;
    this.stopping = false;
    this.exitInfo = null;
  }

  get logFile() {
    return this.logger.file;
  }

  async start() {
    if (await this.portIsBusy(this.port)) throw new PortConflictError(this.port);

    const entry = path.join(this.runtimeDir, "custom-server.js");
    this.logger.log("gateway spawn", `port=${this.port}`, `runtime=${this.runtimeDir}`, `dataDir=${this.env.DATA_DIR}`);

    const preload = new URL("./gateway-ready.mjs", import.meta.url).href;
    this.child = spawn(this.nodePath, ["--import", preload, entry], {
      cwd: this.runtimeDir,
      env: this.env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    });

    const pipe = (stream, level) => {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => this.logger.log(`[${level}]`, redactSecrets(chunk, this.secrets).trimEnd()));
    };
    pipe(this.child.stdout, "out");
    pipe(this.child.stderr, "err");

    this.child.on("exit", (code, signal) => {
      this.exitInfo = { code, signal };
      this.logger.log("gateway exit", `code=${code}`, `signal=${signal}`);
    });
    this.child.on("error", (error) => {
      this.logger.log("gateway spawn error", error && error.message);
    });

    try {
      await new Promise((resolve, reject) => {
        const child = this.child;
        const timer = setTimeout(() => finish(new Error("Gateway did not become healthy: listener startup timed out.")), this.healthTimeoutMs);
        const finish = (error) => {
          clearTimeout(timer);
          child.off("message", onMessage);
          child.off("exit", onExit);
          child.off("error", onError);
          if (error) reject(error);
          else resolve();
        };
        const onMessage = (message) => {
          if (message?.type === "gpuix-gateway-listening" && message.port === this.port) finish();
        };
        const onExit = (code) => finish(new Error(`Gateway exited before listening (code ${code}).`));
        const onError = (error) => finish(error);
        child.on("message", onMessage);
        child.once("exit", onExit);
        child.once("error", onError);
      });
      if (await this.portOwnedByOther(this.port, this.child.pid)) {
        throw new PortConflictError(this.port);
      }
      const health = await waitForHealth({ port: this.port, deadline: Date.now() + this.healthTimeoutMs });
      // Re-prove ownership after health: a foreign specific-address bind can
      // appear between the listener check and this request, and a loopback
      // health call would then be answered by that foreign service.
      if (await this.portOwnedByOther(this.port, this.child.pid)) {
        throw new PortConflictError(this.port);
      }
      this.startPortMonitor();
      this.logger.log("gateway healthy", `port=${this.port}`);
      return health;
    } catch (error) {
      await this.stop();
      if (await this.portIsBusy(this.port)) throw new PortConflictError(this.port);
      throw error;
    }
  }

  // A listener that appears after startup displaces loopback traffic without
  // our socket ever erroring, so ownership is re-proven for the life of the
  // process. Detection fails closed: the gateway is stopped and the shell is
  // told, instead of silently serving a port another process can intercept.
  startPortMonitor() {
    if (this.portMonitor || this.stopping || this.portMonitorMs <= 0) return;
    this.portMonitor = setInterval(() => { void this.checkPortOwnership(); }, this.portMonitorMs);
    this.portMonitor.unref?.();
  }

  // Monitor states:
  //   free     -> reset the streak; nothing is wrong.
  //   busy     -> increment the streak; only `portLossConfirmations` adjacent
  //               confirmations stop the gateway.
  //   unknown  -> netstat failed or timed out. One unknown tick, never proof of
  //               loss; it neither confirms nor clears (only a definitive free
  //               probe disproves the streak).
  //
  // Known trade-off (recorded for issue #1): if netstat stays unavailable, the
  // runtime monitor remains inconclusive, i.e. it is fail-open after boot and
  // cannot stop a gateway whose intruder it cannot see. Boot-time checks stay
  // fail-closed on the same condition because refusing to start is cheap while
  // a false runtime shutdown is not. Do not turn `unknown` into `busy` without
  // eliminating that false-positive risk first.
  async checkPortOwnership() {
    if (this.stopping || this.exitInfo || this.portLost || this.portCheckInFlight) return;
    this.portCheckInFlight = true;
    let probe;
    try {
      probe = await this.portProbe(this.port, {
        exceptPid: this.child?.pid,
        timeoutMs: this.portProbeTimeoutMs,
      });
    } catch (error) {
      probe = { state: "unknown", owners: [], error };
    } finally {
      this.portCheckInFlight = false;
    }
    if (this.stopping || this.exitInfo || this.portLost) return;

    if (probe.state === "free") {
      this.portLossStreak = 0;
      return;
    }
    if (probe.state === "unknown") {
      this.logger.log("port ownership check inconclusive", `port=${this.port}`, "netstat did not answer");
      return;
    }

    this.portLossStreak += 1;
    if (this.portLossStreak < this.portLossConfirmations) {
      this.logger.log(
        "port ownership check: foreign listener suspected",
        `port=${this.port}`,
        `confirmations=${this.portLossStreak}/${this.portLossConfirmations}`
      );
      return;
    }

    this.portLost = true;
    if (this.portMonitor) {
      clearInterval(this.portMonitor);
      this.portMonitor = null;
    }
    this.logger.log("port ownership lost", `port=${this.port}`, "another listener claims the port; stopping the gateway");
    try {
      await this.stop();
    } finally {
      this.notifyPortLost(new PortConflictError(this.port));
    }
  }

  // Called only by the monitor path: an intentional stop (tray quit, signal)
  // is not a port loss and must stay a clean exit. Single-fire so a forced
  // teardown inside stop() cannot produce a second notification.
  notifyPortLost(error) {
    if (this.portLostNotified) return;
    this.portLostNotified = true;
    try {
      this.onPortLost?.(error);
    } catch {
      // The shell's handler must not keep a dead gateway alive.
    }
  }

  stop() {
    if (!this.stopPromise) this.stopPromise = this.stopInternal();
    return this.stopPromise;
  }

  async stopInternal() {
    if (this.portMonitor) {
      clearInterval(this.portMonitor);
      this.portMonitor = null;
    }
    if (!this.child || this.exitInfo) {
      this.logger.close();
      return;
    }
    this.stopping = true;
    const child = this.child;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    const killTimer = setTimeout(() => {
      this.logger.log("gateway did not exit, forcing termination");
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }, this.stopGraceMs);
    // Second timeout: an exit event that never arrives must not hang teardown
    // (and therefore the shell) forever. Force completion only — a forced
    // teardown is not evidence of port loss, so the monitor path remains the
    // sole caller of notifyPortLost (and keeps the PortConflictError type).
    let forceTeardown;
    const forced = new Promise((resolve) => { forceTeardown = resolve; });
    const forceTimer = setTimeout(() => {
      this.logger.log("gateway did not report exit after SIGKILL, forcing teardown");
      forceTeardown("forced");
    }, this.stopGraceMs * 2);
    try {
      await Promise.race([exited, forced]);
    } finally {
      clearTimeout(killTimer);
      clearTimeout(forceTimer);
      this.logger.close();
    }
  }

  isRunning() {
    return Boolean(this.child) && !this.exitInfo;
  }

  // GPUIX terminates the process with process.exit(0) when the window loop
  // ends, which skips async teardown. A synchronous "exit" hook is the only
  // reliable place to avoid leaving a gateway holding a LAN port.
  installExitGuard() {
    if (this.exitGuardInstalled) return;
    this.exitGuardInstalled = true;
    process.on("exit", () => {
      if (!this.child || this.exitInfo) return;
      try {
        this.child.kill();
      } catch {
        // Already gone.
      }
    });
  }
}
