// Native rendering + interaction checks through GPUIX's GPU-backed test
// renderer. Skips when the platform binary has no test renderer so the suite
// still runs on machines where the native addon cannot initialize.
import { describe, expect, it } from "vitest";

const gpuixTest = await import("@gpuix/react/testing");
const { hasNativeTestRenderer, createTestRoot } = gpuixTest;
const React = (await import("react")).default;
const { StatusPanel } = await import("../src/ui/StatusPanel.mjs");
const { initialStatus, STATUS } = await import("../src/ui/status-model.mjs");

const h = React.createElement;

function readyStatus(overrides = {}) {
  return {
    ...initialStatus({ port: 20129, dataDir: "C:\\Users\\example\\AppData\\Roaming\\9router-gpuix", runtimeDir: "C:\\rt" }),
    phase: STATUS.ready,
    version: "0.5.126",
    ...overrides,
  };
}

// One native test window per file: the GPU-backed test renderer opens a real
// GPUI window and cannot be closed, so re-render the same root instead.
let sharedRoot = null;
function mount(node) {
  if (!sharedRoot) sharedRoot = createTestRoot({ width: 1080, height: 720 });
  sharedRoot.render(node);
  return sharedRoot;
}

describe.skipIf(!hasNativeTestRenderer)("StatusPanel native rendering", () => {
  it("paints the gateway url, version, data dir and port", () => {
    const { renderer } = mount(h(StatusPanel, { status: readyStatus(), onRefresh: () => {} }));
    const painted = renderer.getPaintedText().join("\n");
    expect(painted).toContain("9Router Experimental");
    expect(painted).toContain("http://127.0.0.1:20129");
    expect(painted).toContain("0.5.126");
    expect(painted).toContain("9router-gpuix");
    expect(painted).toContain("ready");
  });

  it("shows the failure reason when the gateway is unavailable", () => {
    const status = readyStatus({ phase: STATUS.degraded, version: null, lastError: "connect ECONNREFUSED" });
    const { renderer } = mount(h(StatusPanel, { status, onRefresh: () => {} }));
    const painted = renderer.getPaintedText().join("\n");
    expect(painted).toContain("Gateway unavailable");
    expect(painted).toContain("ECONNREFUSED");
    expect(painted).toContain("degraded");
  });

  it("shows an available update", () => {
    const status = readyStatus({ hasUpdate: true, latestVersion: "0.6.0" });
    const { renderer } = mount(h(StatusPanel, { status, onRefresh: () => {} }));
    const painted = renderer.getPaintedText().join("\n");
    expect(painted).toContain("v0.6.0 available");
  });

  it("calls onRefresh when the refresh control is clicked", () => {
    let clicks = 0;
    const { renderer } = mount(h(StatusPanel, { status: readyStatus(), onRefresh: () => (clicks += 1) }));
    const element = renderer.findByTestId("refresh-status");
    expect(element).toBeTruthy();
    const bounds = renderer.getElementBounds(element.id);
    expect(bounds).toBeTruthy();
    renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    expect(clicks).toBe(1);
  });
});
