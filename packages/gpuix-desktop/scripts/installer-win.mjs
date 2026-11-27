// Builds the per-user NSIS installer from the folder produced by pack-win.mjs.
// The installer is a separate artifact: it never touches the shipping Electron
// install (%LOCALAPPDATA%\Programs\9Router) and uninstalling leaves app data
// (%APPDATA%\9router-gpuix) alone.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const name = `9Router-GPUIX-${pkg.version}-win-x64`;
const srcDir = path.join(packageRoot, "dist-gpuix", name);
const outFile = path.join(packageRoot, "dist-gpuix", `${name}-setup.exe`);

if (!fs.existsSync(path.join(srcDir, "run-gpuix.cmd"))) {
  console.error(`[installer] no packed folder at ${srcDir}; run "npm run pack:win" first.`);
  process.exit(1);
}

function findMakensis() {
  const candidates = [
    path.join(process.env.USERPROFILE || "", "scoop", "shims", "makensis.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "NSIS", "makensis.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "NSIS", "makensis.exe"),
  ];
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  try {
    execFileSync("where", ["makensis"], { stdio: "ignore" });
    return "makensis";
  } catch {
    return null;
  }
}

const makensis = findMakensis();
if (!makensis) {
  console.error("[installer] makensis not found; install NSIS (scoop install nsis) first.");
  process.exit(1);
}

console.log("[installer] compile");
fs.rmSync(outFile, { force: true });
execFileSync(
  makensis,
  [
    "/V2",
    `/DVERSION=${pkg.version}`,
    `/DSRCDIR=${srcDir}`,
    `/DOUTFILE=${outFile}`,
    path.join(packageRoot, "scripts", "installer.nsi"),
  ],
  { stdio: "inherit" }
);

const mb = (fs.statSync(outFile).size / (1024 * 1024)).toFixed(1);
console.log(`[installer] ${path.relative(repoRoot, outFile)} ${mb} MiB`);
