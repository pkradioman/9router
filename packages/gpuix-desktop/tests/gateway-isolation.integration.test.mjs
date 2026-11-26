// End-to-end isolation proof against the real staged gateway.
//
// Boots the actual Next standalone runtime on the experimental port with an
// isolated DATA_DIR and asserts three things that matter:
//   1. the gateway becomes healthy on the configured port,
//   2. every gateway write lands in the isolated directory,
//   3. the installed application's data directory is not modified.
//
// Skipped when the staged runtime and isolated APPDATA are not prepared, so the
// default test run stays hermetic.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gatewayEnv, resolveIsolation, resolvePort } from "../src/config.mjs";
import { GatewaySupervisor, resolveRuntimeDir } from "../src/gateway-supervisor.mjs";
import { loadOrCreateSecrets } from "../src/secrets.mjs";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

let runtimeDir = null;
try {
  runtimeDir = resolveRuntimeDir({ env: {}, packageRoot });
} catch {
  runtimeDir = null;
}

const cleanups = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

async function freePort() {
  const server = net.createServer().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}

function snapshot(dir) {
  try {
    return fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
      .map((file) => {
        const stat = fs.statSync(file, { throwIfNoEntry: false });
        return stat ? `${path.basename(file)}:${stat.size}:${stat.mtimeMs}` : null;
      })
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

const isolatedAppData = process.env.GPU_UIX_TEST_APPDATA;
const canRun = Boolean(runtimeDir) && Boolean(isolatedAppData) && fs.existsSync(isolatedAppData);

describe.runIf(canRun)("isolated gateway integration", () => {
  it("serves health on the experimental port, writes only inside isolated paths, and leaves the installed data alone", async () => {
    const env = { APPDATA: isolatedAppData, LOCALAPPDATA: process.env.LOCALAPPDATA };
    const isolation = resolveIsolation({ env });

    // The stand-in for the installed app's data dir. A real %APPDATA%\9router is
    // being written by the running app, so comparing it would be flaky; this
    // fixture proves the gateway never grows anything under the shared path.
    const sharedFixture = path.join(isolatedAppData, "9router");
    fs.mkdirSync(path.join(sharedFixture, "db"), { recursive: true });
    fs.writeFileSync(path.join(sharedFixture, "db", "data.sqlite"), "installed-app-sentinel");
    const sharedSnapshotBefore = snapshot(sharedFixture);
    expect(sharedSnapshotBefore.length).toBeGreaterThan(0);

    const port = await freePort();
    const secrets = loadOrCreateSecrets(isolation.dataDir);

    const supervisor = new GatewaySupervisor({
      runtimeDir,
      port,
      logDir: isolation.logDir,
      secrets,
      env: gatewayEnv({ isolation, port, secrets, runtimeDir, env }),
      healthTimeoutMs: 90_000,
    });
    cleanups.push(() => supervisor.stop());

    const health = await supervisor.start();
    expect(health).toEqual({ ok: true });

    const res = await fetch(`http://127.0.0.1:${port}/api/version`, { signal: AbortSignal.timeout(8000) });
    expect(res.ok).toBe(true);

    // A protected dashboard API must reject an unauthenticated caller even on
    // loopback: isolation must not weaken authentication.
    const guarded = await fetch(`http://127.0.0.1:${port}/api/providers`, { signal: AbortSignal.timeout(8000) });
    expect(guarded.status).toBeGreaterThanOrEqual(400);

    // A public endpoint that reads persisted settings forces the DB layer to
    // initialize, so the isolated DATA_DIR is exercised, not just created.
    const settings = await fetch(`http://127.0.0.1:${port}/api/settings/require-login`, {
      signal: AbortSignal.timeout(8000),
    });
    expect(settings.ok).toBe(true);

    await supervisor.stop();

    // 1. Gateway state landed in the isolated data dir and nowhere else.
    const isolatedFiles = fs.readdirSync(isolation.dataDir, { recursive: true }).map(String);
    expect(isolatedFiles.some((f) => f.includes("db"))).toBe(true);
    expect(snapshot(isolation.logDir).some((f) => f.startsWith("gateway.log"))).toBe(true);

    // 2. The installed app's data dir is byte-for-byte untouched.
    expect(snapshot(sharedFixture)).toEqual(sharedSnapshotBefore);
    expect(fs.readFileSync(path.join(sharedFixture, "db", "data.sqlite"), "utf8")).toBe("installed-app-sentinel");
  }, 180_000);

  it("refuses to start when the experimental port is occupied, leaving the occupant running", async () => {
    const occupant = net.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => occupant.once("listening", r));
    const { port } = occupant.address();
    cleanups.push(() => new Promise((r) => occupant.close(r)));

    const env = { APPDATA: isolatedAppData, LOCALAPPDATA: process.env.LOCALAPPDATA };
    const isolation = resolveIsolation({ env });
    const secrets = loadOrCreateSecrets(isolation.dataDir);
    const supervisor = new GatewaySupervisor({
      runtimeDir,
      port,
      logDir: isolation.logDir,
      secrets,
      env: gatewayEnv({ isolation, port, secrets, runtimeDir, env }),
      healthTimeoutMs: 5000,
    });
    cleanups.push(() => supervisor.stop());

    await expect(supervisor.start()).rejects.toThrow(/already in use/);
    // The occupant still owns the port.
    expect(occupant.listening).toBe(true);
  }, 60_000);

  it("uses port 20129 by default, never the installed app's 20128", () => {
    expect(resolvePort({})).toBe(20129);
    expect(repoRoot).toBeTruthy();
  });
});

describe.skipIf(canRun)("isolated gateway integration (skipped)", () => {
  it("needs GPU_UIX_TEST_APPDATA pointing at an empty isolated APPDATA and a staged runtime", () => {
    expect(canRun).toBe(false);
  });
});
