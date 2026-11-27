// Silent production install + verification.
//
// Why this exists: running the NSIS setup from Git Bash with a bare `/S` lets MSYS
// rewrite the flag into a path. NSIS then opens the assisted wizard, which closes
// the running app on start — production goes down while nothing is installed.
// Node's spawn passes argv verbatim, so the flag can't be mangled here.
//
//   node scripts/desktop-install.mjs          install, relaunch, verify
//   node scripts/desktop-install.mjs --check  preflight only, no install
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHECK_ONLY = process.argv.includes("--check");
const LOCALAPPDATA = process.env.LOCALAPPDATA;
const INSTALL_DIR = path.join(LOCALAPPDATA, "Programs", "9Router");
const APP_EXE = path.join(INSTALL_DIR, "9Router.exe");
const PORT = 20128;

const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const SETUP = path.join(ROOT, "dist-electron", `9Router-${version}-setup.exe`);

function fail(msg) {
  console.error(`FAIL ${msg}`);
  process.exit(1);
}
function pass(msg) {
  console.log(`PASS ${msg}`);
}

function processList() {
  const r = spawnSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true });
  return (r.stdout || "").split(/\r?\n/).filter(Boolean);
}

function installedVersion() {
  const pkg = path.join(INSTALL_DIR, "resources", "app", "runtime", "package.json");
  try {
    return JSON.parse(fs.readFileSync(pkg, "utf8")).version;
  } catch {
    return null;
  }
}

async function api(pathname, timeoutMs = 5000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}${pathname}`, { signal: ac.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function waitForVersion(expected, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await api("/api/version");
    if (v?.currentVersion === expected) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

if (!fs.existsSync(SETUP)) fail(`installer missing: ${SETUP} (run npm run desktop:pack:win)`);
pass(`artifact ${path.basename(SETUP)} (${fs.statSync(SETUP).size} bytes)`);

const setupName = path.basename(SETUP).toLowerCase();
const wizard = processList().find((line) => line.toLowerCase().includes(setupName));
if (wizard) fail(`an installer is already running (${wizard.split(",")[0]}); close it first`);

const runningApp = processList().some((line) => line.toLowerCase().includes("9router.exe"));
pass(`installed version: ${installedVersion() ?? "missing"}${runningApp ? " (app running)" : " (app not running)"}`);

if (CHECK_ONLY) {
  pass(`preflight ok; would install ${version} and verify /api/version`);
  process.exit(0);
}

const startedAt = Date.now();
console.log(`installing ${version} silently...`);
const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(SETUP, ["/S"], { stdio: "ignore", windowsHide: true });
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error("installer exceeded 10 min — likely an interactive window, aborting"));
  }, 600000);
  child.on("error", reject);
  child.on("close", (code) => {
    clearTimeout(timer);
    resolve(code);
  });
}).catch((err) => fail(err.message));

if (exitCode !== 0) fail(`installer exit code ${exitCode}`);
if (fs.statSync(APP_EXE).mtimeMs < startedAt - 2000) fail("install dir was not updated — install did not run");
pass(`install dir updated (${path.basename(APP_EXE)})`);

const iv = installedVersion();
if (iv !== version) fail(`installed package.json says ${iv}, expected ${version}`);
pass(`installed version ${iv}`);

if (!(await api("/api/version"))) {
  spawn(APP_EXE, [], { detached: true, stdio: "ignore" }).unref();
  pass("launched app");
}

const v = await waitForVersion(version);
if (!v) fail(`app did not report version ${version} on port ${PORT}`);
pass(`/api/version ${v.currentVersion}`);

const health = await api("/api/health");
if (!health?.ok) fail("/api/health not ok");
pass(`/api/health {"ok":true}`);
pass("done");