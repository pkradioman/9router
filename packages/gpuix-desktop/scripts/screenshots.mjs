// Capture every shell page from the native test renderer as a PNG.
//
// Iterating on the look is otherwise blind: the production window has no
// screenshot call, but the test renderer paints the same retained tree through
// DirectX/Metal and can save the frame. Pages are navigated by testId, using the
// same fake API the native tests use.
//
// Usage: node scripts/screenshots.mjs [outDir] [--only page1,page2]
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const argv = process.argv.slice(2);
const onlyIndex = argv.indexOf("--only");
const only = onlyIndex >= 0 ? new Set((argv[onlyIndex + 1] || "").split(",").filter(Boolean)) : null;
const outDir = argv[0] && !argv[0].startsWith("--")
  ? argv[0]
  : path.join(os.tmpdir(), "gpuix-shots");
fs.mkdirSync(outDir, { recursive: true });

const gpuix = await import("@gpuix/react/testing");
if (!gpuix.hasNativeTestRenderer) {
  console.error("native test renderer unavailable");
  process.exit(1);
}
const React = (await import("react")).default;
const { App } = await import("../src/ui/App.mjs");
const { STATUS } = await import("../src/ui/status-model.mjs");
const { makeFakeApi } = await import("../tests/helpers/fake-api.mjs");

const h = React.createElement;
const root = gpuix.createTestRoot({ width: 1536, height: 864 });

const status = {
  phase: STATUS.ready,
  port: 20129,
  baseUrl: "http://127.0.0.1:20129",
  dataDir: "C:\\Users\\example\\AppData\\Roaming\\9router-gpuix",
  runtimeDir: "C:\\rt",
  version: "0.5.126",
  latestVersion: null,
  hasUpdate: false,
  lastError: null,
  checkedAt: null,
};

const api = makeFakeApi((impl) => impl, [
  { id: "k1", name: "laptop", key: "sk-live-1", isActive: true },
  { id: "k2", name: "ci", key: "sk-live-2", isActive: false },
], [
  {
    id: "p1",
    provider: "openai",
    name: "Work",
    isActive: true,
    authType: "api_key",
    testStatus: "active",
    expiresAt: "2027-03-01T00:00:00.000Z",
  },
  {
    id: "p2",
    provider: "anthropic",
    name: "Backup",
    isActive: true,
    authType: "oauth",
    testStatus: "active",
    expiresAt: "2027-01-15T00:00:00.000Z",
  },
]);

async function settle(frames = 8) {
  for (let i = 0; i < frames; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.renderer.flush();
  }
}

function click(testId) {
  const element = root.renderer.findByTestId(testId);
  if (!element) throw new Error(`missing testId ${testId}`);
  const bounds = root.renderer.getElementBounds(element.id);
  root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

const pages = [
  "endpoint",
  "status",
  "chat",
  "providers",
  "models",
  "media-providers",
  "combos",
  "usage",
  "request-log",
  "quota",
  "token-saver",
  "translator",
  "console-log",
  "proxy-pools",
  "skills",
  "pricing",
  "profile",
];

root.render(h(App, { api, status, onRefresh: () => {} }));
await settle();

const targets = pages.filter((entry) => !only || only.has(entry));
for (const page of targets) {
  click(`nav-${page}`);
  await settle(page === "chat" ? 20 : 8);
  const file = path.join(outDir, `${page}.png`);
  root.renderer.captureScreenshot(file);
  console.log(file);
}

console.log(`\n${targets.length} screenshots in ${outDir}`);
process.exit(0);
