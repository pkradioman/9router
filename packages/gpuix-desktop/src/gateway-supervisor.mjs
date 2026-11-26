// Supervises the bundled Node gateway as a child process.
//
// The shell owns the gateway lifetime: it spawns it with an isolated DATA_DIR,
// waits for /api/health, and guarantees teardown on quit or crash so no orphan
// gateway keeps a LAN port open. An occupied port is a hard stop, not an
// invitation to pick another port silently.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { IsolationError, PortConflictError } from "./config.mjs";
import { redactSecrets } from "./secrets.mjs";

export function isPortBusy(port, host = "0.0.0.0", timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: host === "0.0.0.0" ? "127.0.0.1" : host });
    const done = (busy) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
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
  constructor({ runtimeDir, env, port, logDir, secrets, nodePath = process.execPath, healthTimeoutMs = 90_000 }) {
    this.runtimeDir = runtimeDir;
    this.env = env;
    this.port = port;
    this.secrets = secrets;
    this.nodePath = nodePath;
    this.healthTimeoutMs = healthTimeoutMs;
    this.logger = createLogger(logDir);
    this.child = null;
    this.stopping = false;
    this.exitInfo = null;
  }

  get logFile() {
    return this.logger.file;
  }

  async start() {
    if (await isPortBusy(this.port)) throw new PortConflictError(this.port);

    const entry = path.join(this.runtimeDir, "custom-server.js");
    this.logger.log("gateway spawn", `port=${this.port}`, `runtime=${this.runtimeDir}`, `dataDir=${this.env.DATA_DIR}`);

    this.child = spawn(this.nodePath, [entry], {
      cwd: this.runtimeDir,
      env: this.env,
      stdio: ["ignore", "pipe", "pipe"],
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
      const health = await waitForHealth({ port: this.port, deadline: Date.now() + this.healthTimeoutMs });
      this.logger.log("gateway healthy", `port=${this.port}`);
      return health;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop() {
    if (!this.child || this.exitInfo) {
      this.logger.close();
      return;
    }
    this.stopping = true;
    const child = this.child;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    const timer = setTimeout(() => {
      this.logger.log("gateway did not exit, forcing termination");
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }, 5000);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
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
