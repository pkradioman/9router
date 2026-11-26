import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PORT,
  IsolationError,
  experimentalPaths,
  gatewayEnv,
  resolveIsolation,
  resolvePort,
  sharedAppPaths,
} from "../src/config.mjs";

const temps = [];

function tempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpuix-cfg-"));
  temps.push(dir);
  return dir;
}

function isolatedPaths(root) {
  return {
    dataDir: path.join(root, "data"),
    logDir: path.join(root, "logs"),
    cacheDir: path.join(root, "cache"),
  };
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("resolvePort", () => {
  it("defaults to 20129 and never the installed app's 20128", () => {
    expect(DEFAULT_PORT).toBe(20129);
    expect(resolvePort({})).toBe(20129);
  });

  it("accepts an explicit override", () => {
    expect(resolvePort({ NINEROUTER_GPU_UIX_PORT: "20200" })).toBe(20200);
  });

  it.each(["0", "-1", "70000", "abc", "2 0129"])("rejects invalid override %s", (value) => {
    expect(() => resolvePort({ NINEROUTER_GPU_UIX_PORT: value })).toThrow(IsolationError);
  });
});

describe("resolveIsolation", () => {
  it("accepts separate writable directories", () => {
    const root = tempRoot();
    const resolved = resolveIsolation({ paths: isolatedPaths(root) });
    expect(resolved.dataDir).toBe(path.join(root, "data"));
    expect(fs.existsSync(resolved.logDir)).toBe(true);
  });

  it("refuses the installed app's data directory", () => {
    const env = { APPDATA: path.join(tempRoot(), "Roaming"), LOCALAPPDATA: path.join(tempRoot(), "Local") };
    const shared = sharedAppPaths(env);
    expect(() =>
      resolveIsolation({
        env,
        paths: {
          dataDir: shared.dataDir,
          logDir: path.join(tempRoot(), "l"),
          cacheDir: path.join(tempRoot(), "c"),
        },
      })
    ).toThrow(IsolationError);
  });

  it("refuses a directory nested inside the installed app data directory", () => {
    const appData = path.join(tempRoot(), "Roaming");
    const env = { APPDATA: appData };
    const shared = sharedAppPaths(env);
    expect(() =>
      resolveIsolation({
        env,
        paths: {
          dataDir: path.join(shared.dataDir, "nested"),
          logDir: path.join(tempRoot(), "logs"),
          cacheDir: path.join(tempRoot(), "cache"),
        },
      })
    ).toThrow(/overlaps the installed application/);
  });

  it("fails closed when a path is not writable instead of falling back", () => {
    const root = tempRoot();
    const file = path.join(root, "not-a-dir");
    fs.writeFileSync(file, "x");
    expect(() =>
      resolveIsolation({ paths: { dataDir: file, logDir: path.join(root, "l"), cacheDir: path.join(root, "c") } })
    ).toThrow(/not writable/);
  });

  it("refuses two roles sharing one path", () => {
    const root = tempRoot();
    const dir = path.join(root, "same");
    expect(() => resolveIsolation({ paths: { dataDir: dir, logDir: dir, cacheDir: path.join(root, "c") } })).toThrow(
      /reuses another experimental path/
    );
  });

  it("keeps experimental default paths away from the shared app paths", () => {
    const env = { APPDATA: path.join(tempRoot(), "Roaming"), LOCALAPPDATA: path.join(tempRoot(), "Local") };
    const shared = sharedAppPaths(env);
    const experimental = experimentalPaths(env);
    // Compare on path boundaries: "9router-gpuix" must not count as inside "9router".
    const nested = (parent, child) => {
      const rel = path.relative(parent, child);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    };
    for (const dir of Object.values(experimental)) {
      expect(nested(shared.dataDir, dir)).toBe(false);
      expect(nested(shared.installDir, dir)).toBe(false);
    }
    // And the isolation check itself accepts the real defaults.
    expect(() => resolveIsolation({ env, paths: experimental })).not.toThrow();
  });
});

describe("gatewayEnv", () => {
  it("pins data, port and secrets and drops proxy trust", () => {
    const root = tempRoot();
    const isolation = resolveIsolation({ paths: isolatedPaths(root) });
    const env = gatewayEnv({
      isolation,
      port: 20129,
      secrets: { initialPassword: "p", jwtSecret: "j", apiKeySecret: "a", machineIdSalt: "m" },
      runtimeDir: path.join(root, "runtime"),
      env: { PATH: "x", TRUST_PROXY: "true", DATA_DIR: isolation.sharedDataDir },
    });
    expect(env.DATA_DIR).toBe(isolation.dataDir);
    expect(env.PORT).toBe("20129");
    expect(env.HOSTNAME).toBe("0.0.0.0");
    expect(env.TRUST_PROXY).toBeUndefined();
    expect(env.INITIAL_PASSWORD).toBe("p");
    expect(env.API_KEY_SECRET).toBe("a");
    expect(env.PATH).toBe("x");
  });
});
