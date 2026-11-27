import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { assertRuntimeGuard } from "../src/runtime-guard.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it("fails closed unless middleware and all three route guards are present", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gpuix-guard-"));
  roots.push(root);
  const base = path.join(root, "desktop-dist", "server");
  const files = ["middleware.js", "app/api/version/update/route.js", "app/api/version/shutdown/route.js", "app/api/shutdown/route.js"];
  for (const file of files) {
    const target = path.join(base, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "NINEROUTER_GPU_UIX Disabled in the experimental desktop build");
  }
  expect(() => assertRuntimeGuard(root)).not.toThrow();
  fs.writeFileSync(path.join(base, files[2]), "NINEROUTER_GPU_UIX");
  expect(() => assertRuntimeGuard(root)).toThrow(/safety guard missing/);
  fs.rmSync(path.join(base, files[2]));
  expect(() => assertRuntimeGuard(root)).toThrow(/safety guard missing/);
});
