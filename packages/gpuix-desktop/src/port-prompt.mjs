import { spawn } from "node:child_process";
import { resolvePort } from "./config.mjs";

export function askForPort({ entry, occupiedPort, spawnChild = spawn }) {
  return new Promise((resolve, reject) => {
    let selected = null;
    const child = spawnChild(process.execPath, [entry, "--gpuix-port-prompt"], {
      env: { ...process.env, GPU_UIX_CONFLICT_PORT: String(occupiedPort) },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    const cleanup = () => {
      if (!child.killed) child.kill();
    };
    process.once("exit", cleanup);
    child.on("message", (message) => {
      if (message?.type !== "gpuix-port-choice") return;
      try {
        const port = resolvePort({ NINEROUTER_GPU_UIX_PORT: String(message.port) });
        if (port !== occupiedPort) selected = port;
      } catch {
        selected = null;
      }
    });
    child.once("error", (error) => {
      process.off("exit", cleanup);
      reject(error);
    });
    child.once("exit", () => {
      process.off("exit", cleanup);
      resolve(selected);
    });
  });
}
