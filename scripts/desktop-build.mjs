// Builds the desktop bundle end to end: Next standalone (via the repo's own
// `build` script), staged resources, then the Electron portable package.
//
// The standalone dist dir is deliberately not a dot-directory: electron-builder
// copies extraResources through a glob matcher that skips dotfiles, so a
// `.next-*` tree silently disappears from the packaged app.
import { spawnSync } from "node:child_process";

const isWin = process.platform === "win32";
const env = { ...process.env, NEXT_DIST_DIR: "desktop-dist", NEXT_TELEMETRY_DISABLED: "1" };

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", env, shell: isWin });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("npm", ["run", "build"]);
run(process.execPath, ["scripts/desktop-prepare.mjs"]);
run("npx", ["electron-builder", "--win", "portable", "--config", "electron-builder.yml"]);
