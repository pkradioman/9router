import { describe, expect, it, vi } from "vitest";
import { activateIfAlive } from "../src/window-lifecycle.mjs";

function renderer({ initialized = true, ticking = true, throws = false } = {}) {
  return {
    isInitialized: vi.fn(() => initialized),
    requiresTick: vi.fn(() => ticking),
    activateWindow: vi.fn(() => {
      if (throws) throw new Error("invalid window handle");
    }),
  };
}

describe("activateIfAlive", () => {
  it("activates a live window", () => {
    const r = renderer();
    expect(activateIfAlive(r)).toBe("activated");
    expect(r.activateWindow).toHaveBeenCalledTimes(1);
  });

  it("does not touch a renderer whose last window closed", () => {
    const r = renderer({ ticking: false });
    expect(activateIfAlive(r)).toBe("terminated");
    expect(r.activateWindow).not.toHaveBeenCalled();
  });

  it("does not touch an uninitialized renderer", () => {
    const r = renderer({ initialized: false });
    expect(activateIfAlive(r)).toBe("terminated");
    expect(r.activateWindow).not.toHaveBeenCalled();
  });

  it("treats a native throw as termination instead of retrying", () => {
    const r = renderer({ throws: true });
    expect(activateIfAlive(r)).toBe("terminated");
    expect(r.activateWindow).toHaveBeenCalledTimes(1);
  });

  it("tolerates a renderer without the optional probes", () => {
    const r = { activateWindow: vi.fn() };
    expect(activateIfAlive(r)).toBe("activated");
    expect(r.activateWindow).toHaveBeenCalledTimes(1);
  });

  it("reports termination when there is no renderer", () => {
    expect(activateIfAlive(null)).toBe("terminated");
  });
});
