import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { askForPort } from "../src/port-prompt.mjs";

it("returns a selected alternative only after the prompt closes", async () => {
  const child = new EventEmitter();
  child.kill = vi.fn();
  const spawnChild = vi.fn(() => child);
  const result = askForPort({ entry: "main.mjs", occupiedPort: 20129, spawnChild });
  expect(spawnChild.mock.calls[0][2].env.GPU_UIX_CONFLICT_PORT).toBe("20129");
  child.emit("message", { type: "gpuix-port-choice", port: 20200 });
  child.emit("exit", 0);
  await expect(result).resolves.toBe(20200);
});

it.each([20128, 20129, 0, 65536])("rejects invalid or reserved choice %s", async (port) => {
  const child = new EventEmitter();
  child.kill = vi.fn();
  const result = askForPort({ entry: "main.mjs", occupiedPort: 20129, spawnChild: () => child });
  child.emit("message", { type: "gpuix-port-choice", port });
  child.emit("exit", 0);
  await expect(result).resolves.toBeNull();
});

it("treats closing the prompt as cancellation", async () => {
  const child = new EventEmitter();
  child.kill = vi.fn();
  const result = askForPort({ entry: "main.mjs", occupiedPort: 20129, spawnChild: () => child });
  child.emit("exit", 0);
  await expect(result).resolves.toBeNull();
});
