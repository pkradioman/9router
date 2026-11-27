import fs from "node:fs";
import path from "node:path";
import { IsolationError } from "./config.mjs";

const FILES = [
  "middleware.js",
  "app/api/version/update/route.js",
  "app/api/version/shutdown/route.js",
  "app/api/shutdown/route.js",
];
const MARKER = "Disabled in the experimental desktop build";

export function assertRuntimeGuard(runtimeDir) {
  const serverDir = path.join(runtimeDir, "desktop-dist", "server");
  for (const file of FILES) {
    let source;
    try {
      source = fs.readFileSync(path.join(serverDir, file), "utf8");
    } catch {
      throw new IsolationError(`Experimental runtime safety guard missing: ${file}`);
    }
    if (!source.includes(MARKER) || !source.includes("NINEROUTER_GPU_UIX")) {
      throw new IsolationError(`Experimental runtime safety guard missing: ${file}`);
    }
  }
}
