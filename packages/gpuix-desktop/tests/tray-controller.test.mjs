import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { TrayController } from "../src/tray-controller.mjs";

function fixture() {
  const tray = {
    onClick(fn) { this.click = fn; },
    onExit(fn) { this.exit = fn; },
    onReady(fn) { this.ready = fn; },
    onError(fn) { this.error = fn; },
    kill: vi.fn(),
  };
  const children = [];
  const spawnWindow = vi.fn(() => {
    const child = new EventEmitter();
    child.kill = vi.fn();
    children.push(child);
    return child;
  });
  const onQuit = vi.fn();
  const controller = new TrayController({
    createTray: () => tray,
    icon: "test-icon",
    windowEntry: "window.mjs",
    status: { port: 20129 },
    onQuit,
    spawnWindow,
  });
  return { controller, tray, children, spawnWindow, onQuit };
}

describe("TrayController", () => {
  it("keeps the host alive after close and recreates one window on restore", async () => {
    const { controller, tray, children, spawnWindow } = fixture();
    const started = controller.start();
    expect(spawnWindow).not.toHaveBeenCalled();
    tray.ready();
    await started;
    expect(children).toHaveLength(1);
    tray.click({ seq_id: 0 });
    expect(children).toHaveLength(1);
    children[0].emit("exit", 0);
    tray.click({ seq_id: 0 });
    expect(children).toHaveLength(2);
    expect(spawnWindow.mock.calls[1][2].env.GPU_UIX_WINDOW_STATUS).toBe('{"port":20129}');
  });

  it("quits on tray loss or quit action and stops only owned children", async () => {
    const { controller, tray, children, onQuit } = fixture();
    const started = controller.start();
    tray.ready();
    await started;
    tray.click({ seq_id: 1 });
    tray.exit();
    expect(onQuit).toHaveBeenCalledTimes(2);
    controller.stop();
    controller.stop();
    expect(children[0].kill).toHaveBeenCalledTimes(1);
    expect(tray.kill).toHaveBeenCalledOnce();
    tray.exit();
    expect(onQuit).toHaveBeenCalledTimes(2);
  });

  it("fails startup if tray helper cannot launch", async () => {
    const { controller, tray, spawnWindow } = fixture();
    const started = controller.start();
    tray.error(new Error("tray failed"));
    await expect(started).rejects.toThrow("tray failed");
    expect(spawnWindow).not.toHaveBeenCalled();
    controller.stop();
  });
});
