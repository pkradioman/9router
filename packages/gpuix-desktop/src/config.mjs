// Isolation contract for the experimental desktop shell.
//
// Every path this package writes must be provably separate from the installed
// application (%APPDATA%\9router). The gateway's own DATA_DIR resolver silently
// falls back to that shared directory when the configured path is not writable,
// so this module verifies isolation before the gateway is ever spawned and
// throws instead of falling back.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SHARED_APP_DIR_NAME = "9router";
export const EXPERIMENTAL_APP_DIR_NAME = "9router-gpuix";
export const DEFAULT_PORT = 20129;

export class IsolationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "IsolationError";
    this.details = details;
  }
}

export class PortConflictError extends Error {
  constructor(port) {
    super(
      `Port ${port} is already in use. The experimental gateway will not take over an occupied port; close the other process or choose another port with NINEROUTER_GPU_UIX_PORT.`
    );
    this.name = "PortConflictError";
    this.port = port;
  }
}

function envDir(env, key, fallback) {
  const value = env[key];
  return value && value.trim() ? value.trim() : fallback;
}

function normalize(value) {
  const missing = [];
  let existing = path.resolve(value);
  while (true) {
    try {
      fs.lstatSync(existing);
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      missing.unshift(path.basename(existing));
      existing = parent;
    }
  }
  let resolved;
  try {
    resolved = path.join(fs.realpathSync(existing), ...missing);
  } catch (error) {
    throw new IsolationError(`Cannot resolve isolated path ${value}.`, { cause: error.message });
  }
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isInside(parent, child) {
  const p = normalize(parent);
  const c = normalize(child);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

export function sharedAppPaths(env = process.env) {
  if (process.platform === "win32") {
    const appData = envDir(env, "APPDATA", path.join(os.homedir(), "AppData", "Roaming"));
    return {
      dataDir: path.join(appData, SHARED_APP_DIR_NAME),
      installDir: path.join(
        envDir(env, "LOCALAPPDATA", path.join(os.homedir(), "AppData", "Local")),
        "Programs",
        "9Router"
      ),
    };
  }
  return {
    dataDir: path.join(os.homedir(), `.${SHARED_APP_DIR_NAME}`),
    installDir: path.join(os.homedir(), ".local", "share", SHARED_APP_DIR_NAME),
  };
}

export function experimentalPaths(env = process.env) {
  if (process.platform === "win32") {
    const appData = envDir(env, "APPDATA", path.join(os.homedir(), "AppData", "Roaming"));
    const localAppData = envDir(env, "LOCALAPPDATA", path.join(os.homedir(), "AppData", "Local"));
    const root = path.join(localAppData, EXPERIMENTAL_APP_DIR_NAME);
    return {
      dataDir: path.join(appData, EXPERIMENTAL_APP_DIR_NAME),
      logDir: path.join(root, "logs"),
      cacheDir: path.join(root, "cache"),
    };
  }
  const root = path.join(os.homedir(), `.${EXPERIMENTAL_APP_DIR_NAME}`);
  return {
    dataDir: root,
    logDir: path.join(root, "logs"),
    cacheDir: path.join(root, "cache"),
  };
}

function assertWritableDir(dir, label) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, "ok", { mode: 0o600 });
    fs.rmSync(probe, { force: true });
  } catch (error) {
    throw new IsolationError(
      `${label} ${dir} is not writable; refusing to fall back to the installed application's shared data directory.`,
      { dir, label, cause: error && error.message }
    );
  }
}

export function resolveIsolation({ env = process.env, paths = experimentalPaths(env) } = {}) {
  const shared = sharedAppPaths(env);
  const guarded = [
    ["dataDir", paths.dataDir],
    ["logDir", paths.logDir],
    ["cacheDir", paths.cacheDir],
  ];
  for (const [label, dir] of guarded) {
    if (!dir || typeof dir !== "string") {
      throw new IsolationError(`Missing ${label}; experimental mode requires explicit paths.`, { label });
    }
    if (isInside(shared.dataDir, dir) || isInside(shared.installDir, dir)) {
      throw new IsolationError(
        `${label} ${dir} overlaps the installed application (${shared.dataDir}); refusing to run.`,
        { label, dir, shared: shared.dataDir }
      );
    }
  }
  const seen = new Set();
  for (const [label, dir] of guarded) {
    const key = normalize(dir);
    if (seen.has(key)) {
      throw new IsolationError(`${label} reuses another experimental path (${dir}).`, { label, dir });
    }
    seen.add(key);
  }
  for (const [label, dir] of guarded) assertWritableDir(dir, label);

  return {
    dataDir: path.resolve(paths.dataDir),
    logDir: path.resolve(paths.logDir),
    cacheDir: path.resolve(paths.cacheDir),
    sharedDataDir: path.resolve(shared.dataDir),
  };
}

export function resolvePort(env = process.env) {
  const raw = env.NINEROUTER_GPU_UIX_PORT;
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  // Strict: "20129abc" and "2 0129" must not silently become a valid port.
  const port = /^[0-9]+$/.test(raw.trim()) ? Number.parseInt(raw.trim(), 10) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new IsolationError(`NINEROUTER_GPU_UIX_PORT must be a TCP port between 1 and 65535, got "${raw}".`);
  }
  if (port === 20128) {
    throw new IsolationError("Port 20128 is reserved for the installed application.");
  }
  return port;
}

// The gateway reads every path and secret at module load, so the child process
// receives them explicitly instead of inheriting an interactive shell's env.
export function gatewayEnv({ isolation, port, secrets, runtimeDir, env = process.env }) {
  const merged = { ...env };
  delete merged.TRUST_PROXY;
  return {
    ...merged,
    NODE_ENV: "production",
    PORT: String(port),
    // Same LAN binding as the installed app; the shell never widens it further.
    HOSTNAME: "0.0.0.0",
    DATA_DIR: isolation.dataDir,
    NINEROUTER_GPU_UIX: "1",
    INITIAL_PASSWORD: secrets.initialPassword,
    JWT_SECRET: secrets.jwtSecret,
    API_KEY_SECRET: secrets.apiKeySecret,
    MACHINE_ID_SALT: secrets.machineIdSalt,
    NEXT_TELEMETRY_DISABLED: "1",
    DISABLE_BACKGROUND_TOKEN_REFRESH: "1",
    GPU_UIX_RUNTIME_DIR: runtimeDir,
  };
}
