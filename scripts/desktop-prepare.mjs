// Stages the Next standalone build for electron-builder: copies the runtime
// source dirs it needs and drops native modules the desktop build does not use
// (the DB driver falls back to node:sqlite, images are unoptimized, and wreq-js
// is downloaded lazily into the user data dir at first use).
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const distDir = process.env.NEXT_DIST_DIR || ".next-cli-build";
const standalone = join(root, distDir, "standalone");

if (!existsSync(standalone)) {
  console.error(`[desktop] no standalone build at ${standalone}; run "npm run build" first`);
  process.exit(1);
}

for (const dir of ["open-sse", "src", "cli"]) {
  const from = join(root, dir);
  const to = join(standalone, dir);
  if (!existsSync(from)) continue;
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, {
    recursive: true,
    filter: (src) => !src.includes(`${dir === "open-sse" ? "/open-sse/" : "/" + dir + "/"}node_modules`),
  });
  console.log(`[desktop] staged ${dir}`);
}

const prune = ["better-sqlite3", "sharp", "wreq-js", "playwright-core", "@img"];
for (const name of prune) {
  const target = join(standalone, "node_modules", name);
  if (!existsSync(target)) continue;
  rmSync(target, { recursive: true, force: true });
  console.log(`[desktop] pruned node_modules/${name}`);
}
