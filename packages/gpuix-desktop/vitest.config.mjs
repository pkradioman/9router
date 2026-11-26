import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.mjs"],
    // Native GPUIX renderer and process supervision both need real time and a
    // GPU context; run files serially so one window/port does not overlap another.
    fileParallelism: false,
    testTimeout: 40_000,
    hookTimeout: 40_000,
  },
});
