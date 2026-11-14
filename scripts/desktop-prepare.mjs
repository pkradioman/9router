// Stages a self-contained app tree for electron-builder at desktop-app/.
//
// Sources: the Next standalone output plus the runtime source dirs it needs.
// Pruned: native modules the desktop build does not use (the DB driver falls
// back to node:sqlite, images are unoptimized, wreq-js is fetched lazily into
// the user data dir at first use), so the bundle stays pure JS.
import { cpSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const distDir = process.env.NEXT_DIST_DIR || "desktop-dist";
const standalone = join(root, distDir, "standalone");
const stage = join(root, "desktop-app");

if (!existsSync(standalone)) {
  console.error(`[desktop] no standalone build at ${standalone}; run "npm run build" with NEXT_DIST_DIR=${distDir} first`);
  process.exit(1);
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

cpSync(standalone, stage, { recursive: true, dereference: true });
console.log(`[desktop] staged standalone -> desktop-app`);

// The standalone output omits these because Next traces only what it imports
// statically; the gateway loads them at runtime.
for (const dir of ["open-sse", "src", "cli"]) {
  const from = join(root, dir);
  if (!existsSync(from)) continue;
  rmSync(join(stage, dir), { recursive: true, force: true });
  cpSync(from, join(stage, dir), {
    recursive: true,
    filter: (src) => !/[\\/]node_modules([\\/]|$)/.test(src.slice(from.length)),
  });
  console.log(`[desktop] staged ${dir}`);
}

const prune = ["better-sqlite3", "sharp", "wreq-js", "playwright-core", "playwright", "@img"];
for (const name of prune) {
  const target = join(stage, "node_modules", name);
  if (!existsSync(target)) continue;
  rmSync(target, { recursive: true, force: true });
  console.log(`[desktop] pruned node_modules/${name}`);
}
