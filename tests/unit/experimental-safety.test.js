import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const prev = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in prev)) delete process.env[key];
  }
  Object.assign(process.env, prev);
}

afterEach(restoreEnv);

describe("experimentalSafety", () => {
  it("blocks the self-update and cross-process kill routes in experimental mode", async () => {
    process.env.NINEROUTER_GPU_UIX = "1";
    const { blockedExperimentalPath, EXPERIMENTAL_BLOCKED_PATHS } = await import("@/lib/experimentalSafety.js");
    expect(EXPERIMENTAL_BLOCKED_PATHS).toEqual(["/api/version/update", "/api/version/shutdown", "/api/shutdown"]);
    for (const p of EXPERIMENTAL_BLOCKED_PATHS) expect(blockedExperimentalPath(p)).toBe(p);
    // Prefix matches must not leak onto unrelated routes.
    expect(blockedExperimentalPath("/api/version")).toBe(null);
    expect(blockedExperimentalPath("/api/versions/update")).toBe(null);
    expect(blockedExperimentalPath("/api/health")).toBe(null);
  });

  it("blocks nothing outside experimental mode", async () => {
    delete process.env.NINEROUTER_GPU_UIX;
    const { blockedExperimentalPath } = await import("@/lib/experimentalSafety.js");
    expect(blockedExperimentalPath("/api/version/update")).toBe(null);
    expect(blockedExperimentalPath("/api/shutdown")).toBe(null);
  });

  it("is inert for empty or non-string paths", async () => {
    process.env.NINEROUTER_GPU_UIX = "1";
    const { blockedExperimentalPath } = await import("@/lib/experimentalSafety.js");
    expect(blockedExperimentalPath("")).toBe(null);
    expect(blockedExperimentalPath(undefined)).toBe(null);
  });
});

describe("appUpdater experimental refusal", () => {
  beforeEach(() => {
    process.env.NINEROUTER_GPU_UIX = "1";
  });

  it("refuses to kill processes", async () => {
    const { killAppProcesses } = await import("@/lib/appUpdater.js");
    await expect(killAppProcesses()).rejects.toThrow(/disabled in the experimental desktop build/);
  });

  it("refuses to spawn the npm updater and exit", async () => {
    const { spawnUpdaterAndExit } = await import("@/lib/appUpdater.js");
    expect(() => spawnUpdaterAndExit()).toThrow(/disabled in the experimental desktop build/);
  });
});

// Structural guarantee: any route that can kill processes or replace the global
// package is either in the blocked list or refuses experimental mode itself.
// A new such route added later must fail this test rather than ship silently.
describe("no unguarded process-killing route", () => {
  const repoRoot = path.resolve(import.meta.dirname, "..", "..");
  const apiRoot = path.join(repoRoot, "src", "app", "api");

  function routeFiles(dir) {
    const out = [];
    const walk = (current) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "route.js") out.push(full);
      }
    };
    walk(dir);
    return out;
  }

  it("every route that kills processes or spawns the updater is blocked", async () => {
    const { EXPERIMENTAL_BLOCKED_PATHS } = await import("@/lib/experimentalSafety.js");
    const risky = [];
    for (const file of routeFiles(apiRoot)) {
      const source = fs.readFileSync(file, "utf8");
      if (!/killAppProcesses|spawnUpdaterAndExit/.test(source)) continue;
      const relative = path.relative(path.join(repoRoot, "src", "app"), file).replace(/\\/g, "/");
      const pathname = `/${relative.replace(/\/route\.js$/, "")}`;
      const guarded =
        EXPERIMENTAL_BLOCKED_PATHS.includes(pathname) || /isExperimentalMode\(\)/.test(source);
      risky.push({ file: pathname, guarded });
    }
    expect(risky.length).toBeGreaterThan(0);
    expect(risky.filter((entry) => !entry.guarded)).toEqual([]);
  });
});

describe("dataDir fail-closed in experimental mode", () => {
  const temps = [];
  function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-dd-"));
    temps.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  // dataDir.js resolves DATA_DIR at import time, so give the import a valid dir
  // and drive the pure resolver with explicit env objects from there.
  async function loadResolver() {
    process.env.DATA_DIR = tempDir();
    const { resolveDataDir } = await import("@/lib/dataDir.js");
    return resolveDataDir;
  }

  it("throws instead of falling back when DATA_DIR is unset", async () => {
    const resolveDataDir = await loadResolver();
    expect(() => resolveDataDir({ NINEROUTER_GPU_UIX: "1" })).toThrow(/refusing to fall back/);
  });

  it("uses an explicit writable DATA_DIR", async () => {
    const resolveDataDir = await loadResolver();
    const dir = tempDir();
    expect(resolveDataDir({ NINEROUTER_GPU_UIX: "1", DATA_DIR: dir })).toBe(dir);
  });

  it("refuses a Unix-style DATA_DIR on Windows in experimental mode", async () => {
    const resolveDataDir = await loadResolver();
    if (process.platform !== "win32") return;
    expect(() => resolveDataDir({ NINEROUTER_GPU_UIX: "1", DATA_DIR: "/var/lib/9router" })).toThrow(
      /refusing to fall back/
    );
  });

  it("throws instead of falling back when DATA_DIR cannot be created", async () => {
    const resolveDataDir = await loadResolver();
    const dir = tempDir();
    const file = path.join(dir, "not-a-dir");
    fs.writeFileSync(file, "x");
    // Either the explicit refusal or the raw mkdir error is acceptable; both are
    // fail-closed. What must never happen is a silent fallback to %APPDATA%\9router.
    expect(() => resolveDataDir({ NINEROUTER_GPU_UIX: "1", DATA_DIR: path.join(file, "child") })).toThrow();
  });

  it("keeps the historical fallback when not in experimental mode", async () => {
    const resolveDataDir = await loadResolver();
    expect(resolveDataDir({})).toMatch(/9router$/);
  });
});
