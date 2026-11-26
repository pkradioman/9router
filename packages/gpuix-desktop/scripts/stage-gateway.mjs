// Stages the bundled gateway runtime into resources/gateway.
//
// Source is the same Next standalone tree the installed desktop app ships
// (desktop-app/runtime, produced by `npm run desktop:prepare` at the repository
// root). The copy lives inside this package so packaging never reaches into the
// installed application.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(process.env.GPU_UIX_GATEWAY_SOURCE || path.join(packageRoot, "..", "..", "desktop-app", "runtime"));
const target = path.join(packageRoot, "resources", "gateway");

if (!fs.existsSync(path.join(source, "custom-server.js"))) {
  console.error(`[stage-gateway] no staged runtime at ${source}`);
  console.error('[stage-gateway] run "npm run desktop:prepare" at the repository root first');
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(source, target, { recursive: true, dereference: true });

const bytes = fs
  .readdirSync(target, { withFileTypes: true })
  .length;
console.log(`[stage-gateway] ${source} -> ${target} (${bytes} top-level entries)`);
