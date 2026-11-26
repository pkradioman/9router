// Verifies the ACTUAL staged gateway runtime against an isolated APPDATA.
//
// Boots the same standalone tree the desktop app ships, on the experimental
// port, and reports: DB-backed reads/writes landing only in the isolated dir,
// the installed app's data dir staying byte-identical, the self-update/kill
// routes being refused, and LAN unauthenticated rejection plus an authenticated
// mock-account round trip. No provider account is used and nothing outside the
// isolated temp tree is written.
//
//   npm --prefix packages/gpuix-desktop run verify:gateway
//   npm --prefix packages/gpuix-desktop run verify:gateway -- --lan
//   npm --prefix packages/gpuix-desktop run verify:gateway -- --keep
//
// Exit code 0 means every check passed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gatewayEnv, resolveIsolation, resolvePort, sharedAppPaths } from "../src/config.mjs";
import { loadOrCreateSecrets } from "../src/secrets.mjs";
import { GatewaySupervisor, resolveRuntimeDir } from "../src/gateway-supervisor.mjs";
import {
  checkAuthenticatedLanMockFlow,
  checkExperimentalRouteBlocks,
  checkUnauthenticatedLanRejection,
  summarize,
} from "../src/security-check.mjs";
import { assertIsolationHeld, snapshotDir } from "../src/isolation-proof.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const wantLan = args.has("--lan");
const keep = args.has("--keep");

// A LAN address on this machine, so the LAN path is exercised without a second
// host. Loopback-only fallback keeps the script usable on an offline box.
function lanAddress() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return null;
}

// Everything the run creates lives under one temp root that is deleted at the
// end, so %APPDATA%\9router is never the DATA_DIR or log dir.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "9r-gpuix-verify-"));
const roaming = path.join(root, "Roaming");
const local = path.join(root, "Local");
fs.mkdirSync(roaming, { recursive: true });
fs.mkdirSync(local, { recursive: true });

// Stand-in for the installed app's data dir: a sentinel file proves isolation
// without reading the real one (which a running app is writing).
const sharedFixture = path.join(roaming, "9router");
fs.mkdirSync(path.join(sharedFixture, "db"), { recursive: true });
fs.writeFileSync(path.join(sharedFixture, "db", "data.sqlite"), "installed-app-sentinel");
const sharedBefore = snapshotDir(sharedFixture);

const env = { ...process.env, APPDATA: roaming, LOCALAPPDATA: local };
delete env.NINEROUTER_GPU_UIX_PORT;

const report = { root, checks: [], errors: [], files: {}, startedAt: new Date().toISOString() };
let failed = false;

try {
  const isolation = resolveIsolation({ env });
  const port = resolvePort(env);
  const secrets = loadOrCreateSecrets(isolation.dataDir);
  const runtimeDir = resolveRuntimeDir({ env, packageRoot });
  const lan = wantLan ? lanAddress() : null;

  report.isoDataDir = isolation.dataDir;
  report.runtimeDir = runtimeDir;
  report.port = port;
  report.sharedDataDir = sharedAppPaths(env).dataDir;
  report.lanHost = lan;
  if (wantLan && !lan) report.errors.push("--lan requested but no non-internal IPv4 interface exists");

  const supervisor = new GatewaySupervisor({
    runtimeDir,
    port,
    logDir: isolation.logDir,
    secrets,
    env: gatewayEnv({ isolation, port, secrets, runtimeDir, env }),
    healthTimeoutMs: 120_000,
  });

  try {
    report.health = await supervisor.start();
    const loopback = `http://127.0.0.1:${port}`;

    const groups = [
      ["loopback unauth", await checkUnauthenticatedLanRejection({ baseUrl: loopback, isLoopback: true })],
      ["route blocks", await checkExperimentalRouteBlocks({ baseUrl: loopback })],
      [
        "loopback authenticated mock flow",
        await checkAuthenticatedLanMockFlow({ baseUrl: loopback, password: secrets.initialPassword }),
      ],
    ];

    if (lan) {
      const lanBase = `http://${lan}:${port}`;
      groups.push(
        ["LAN unauth", await checkUnauthenticatedLanRejection({ baseUrl: lanBase, isLoopback: false })],
        ["LAN route blocks", await checkExperimentalRouteBlocks({ baseUrl: lanBase })],
        [
          "LAN authenticated mock flow",
          await checkAuthenticatedLanMockFlow({ baseUrl: lanBase, password: secrets.initialPassword }),
        ]
      );
    }

    for (const [group, results] of groups) {
      const summary = summarize(results);
      report.checks.push({ group, ...summary, results });
      if (summary.failures.length) failed = true;
    }
  } finally {
    await supervisor.stop();
    report.gatewayLog = supervisor.logFile;
  }

  // DB-backed state must be in the isolated tree, and the installed app's data
  // dir must be untouched.
  assertIsolationHeld({ isolation, sharedDataDir: sharedFixture, sharedBefore });
  report.files.isolatedCount = snapshotDir(isolation.dataDir).length;
  report.files.sharedUnchanged = JSON.stringify(sharedBefore) === JSON.stringify(snapshotDir(sharedFixture));
  report.files.sharedSentinel = fs.readFileSync(path.join(sharedFixture, "db", "data.sqlite"), "utf8");
  if (!report.files.sharedUnchanged) failed = true;
  if (report.files.sharedSentinel !== "installed-app-sentinel") failed = true;
} catch (error) {
  failed = true;
  report.errors.push(String((error && error.stack) || error));
}

if (!keep) fs.rmSync(root, { recursive: true, force: true });
report.passed = !failed;
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(failed ? 1 : 0);
