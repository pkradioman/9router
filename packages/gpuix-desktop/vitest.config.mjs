import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.mjs"],
    // Native GPUIX renderer and process supervision both need real time and a
    // GPU context; run files serially so one window/port does not overlap another.
    fileParallelism: false,
    // One worker process for the whole run: a fork per file showed up as a
    // burst of node.exe processes in Task Manager (and each fork held its own
    // GPU test window until exit).
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 40_000,
    hookTimeout: 40_000,
  },
});
