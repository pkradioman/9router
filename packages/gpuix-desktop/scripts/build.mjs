// Bundles the shell into a single ESM file.
//
// GPUIX 0.11 ships ESM-only subpaths (@gpuix/react, /testing, /automation), so
// CommonJS output cannot load it. The bundle is emitted as .mjs and the native
// @gpuix/native binary package stays external so it resolves from node_modules.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(packageRoot, "dist", "main.mjs");

fs.rmSync(path.join(packageRoot, "dist"), { recursive: true, force: true });

await build({
  entryPoints: [path.join(packageRoot, "src", "main.mjs")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  banner: {
    js: "import { createRequire as __gpuixCreateRequire } from 'node:module'; const require = __gpuixCreateRequire(import.meta.url);",
  },
  external: [
    // Native addon + its per-platform binary packages must load from disk.
    "@gpuix/native",
    "@gpuix/native-*",
    "@gpuix/react",
    "react",
    "react-dom",
  ],
});

const size = fs.statSync(outfile).size;
console.log(`[build] ${path.relative(packageRoot, outfile)} ${(size / 1024).toFixed(1)} KiB`);
