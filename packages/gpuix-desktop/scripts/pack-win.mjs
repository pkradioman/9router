// Packages the experimental shell as a self-contained Windows folder + zip.
//
// Layout:
//   9Router-GPUIX-win-x64/
//     node.exe               (the Node that runs the shell)
//     dist/                  (esbuild bundle + icon + gateway-ready preload)
//     node_modules/          (production deps only, incl. the GPUIX native addon)
//     resources/gateway/     (the staged Next standalone runtime)
//     run-gpuix.cmd          (launcher; extra args pass through)
//
// This is the portable precursor of a real installer: it does not touch an
// existing 9Router install, uses its own data dir (%APPDATA%\9router-gpuix) and
// its own port (20129), so it can coexist with the shipping Electron app.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const name = `9Router-GPUIX-${pkg.version}-win-x64`;
const outRoot = path.join(packageRoot, "dist-gpuix");
const outDir = path.join(outRoot, name);

const runtimeSrc = path.join(repoRoot, "desktop-app", "runtime");
if (!fs.existsSync(path.join(runtimeSrc, "custom-server.js"))) {
  console.error(`[pack] no staged runtime at ${runtimeSrc}; run "npm run desktop:stage" first.`);
  process.exit(1);
}

console.log("[pack] build");
execFileSync(process.execPath, [path.join(packageRoot, "scripts", "build.mjs")], { stdio: "inherit" });

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

function copy(from, to) {
  fs.cpSync(from, to, { recursive: true, dereference: true });
}

console.log("[pack] shell files");
copy(path.join(packageRoot, "dist"), path.join(outDir, "dist"));
fs.copyFileSync(path.join(packageRoot, "package.json"), path.join(outDir, "package.json"));

console.log("[pack] node runtime");
fs.copyFileSync(process.execPath, path.join(outDir, "node.exe"));

console.log("[pack] production node_modules");
// --parseable lists every production dependency path, transitive included;
// copying each keeps the tree (scope dirs, optional platform packages) intact.
const listed = execFileSync(
  "npm",
  ["ls", "--omit=dev", "--all", "--parseable"],
  { cwd: packageRoot, encoding: "utf8", shell: process.platform === "win32" }
)
  .split(/\r?\n/)
  .filter(Boolean);
let copied = 0;
for (const entry of listed) {
  const rel = path.relative(packageRoot, entry);
  if (!rel.startsWith(`node_modules${path.sep}`) && !rel.startsWith("node_modules/")) continue;
  const dest = path.join(outDir, rel);
  if (fs.existsSync(dest)) continue;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copy(entry, dest);
  copied += 1;
}

console.log("[pack] staged gateway runtime");
copy(runtimeSrc, path.join(outDir, "resources", "gateway"));

fs.writeFileSync(
  path.join(outDir, "run-gpuix.cmd"),
  [
    "@echo off",
    "setlocal",
    '"%~dp0node.exe" "%~dp0dist\\main.mjs" %*',
    "endlocal",
    "",
  ].join("\r\n")
);

console.log("[pack] zip");
const zipPath = path.join(outRoot, `${name}.zip`);
fs.rmSync(zipPath, { force: true });
const sevenZip = path.join(process.env.ProgramFiles || "C:\\Program Files", "7-Zip", "7z.exe");
if (fs.existsSync(sevenZip)) {
  // bsdtar's -a writes zip entries without deflating; 7-Zip compresses properly.
  execFileSync(sevenZip, ["a", "-tzip", "-mx=7", zipPath, name], { stdio: "inherit", cwd: outRoot });
} else {
  execFileSync(
    "powershell",
    ["-NoProfile", "-Command", `Compress-Archive -Path '${name}' -DestinationPath '${zipPath}' -Force`],
    { stdio: "inherit", cwd: outRoot }
  );
}

const mb = (target) => {
  const size = fs.statSync(target).size;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
};
console.log(`[pack] ${path.relative(repoRoot, zipPath)} ${mb(zipPath)} (${copied} package dirs)`);
