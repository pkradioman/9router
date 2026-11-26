// Runs the repository's gateway Vitest suite (tests/**/*.test.js) from inside this
// package, because the repository's own `tests/` install is not present in this
// checkout and this package already ships Vitest.
//
// The repository config supplies the `@/` and `open-sse/` aliases; paths are
// derived from this file so the config works in any checkout location.
//
//   node packages/gpuix-desktop/node_modules/vitest/vitest.mjs run \
//     --config packages/gpuix-desktop/vitest.gateway.mjs tests/unit/experimental-safety.test.js
import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageRoot, "..", "..");

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.js"],
    exclude: ["**/node_modules/**", "**/desktop-app/**", "**/.claude/**", "**/dist/**"],
    dir: repoRoot,
    silent: false,
  },
  resolve: {
    alias: [
      { find: /^open-sse\//, replacement: path.join(repoRoot, "open-sse") + path.sep },
      { find: "open-sse", replacement: path.join(repoRoot, "open-sse") },
      { find: /^@\//, replacement: path.join(repoRoot, "src") + path.sep },
    ],
  },
});
