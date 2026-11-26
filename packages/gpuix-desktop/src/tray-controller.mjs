import { spawn } from "node:child_process";

export class TrayController {
  constructor({ createTray, icon, windowEntry, status, onQuit, spawnWindow = spawn }) {
    this.createTray = createTray;
    this.icon = icon;
    this.windowEntry = windowEntry;
    this.status = status;
    this.onQuit = onQuit;
    this.spawnWindow = spawnWindow;
    this.window = null;
    this.tray = null;
    this.stopping = false;
  }

  async start() {
    const tray = this.createTray({
      menu: {
        icon: this.icon,
        title: "9Router Experimental",
        tooltip: "9Router Experimental",
        items: [
          { title: "Open 9Router", tooltip: "Open 9Router", enabled: true, checked: false },
          { title: "Quit", tooltip: "Quit 9Router", enabled: true, checked: false },
        ],
      },
      debug: false,
      copyDir: false,
    });
    this.tray = tray;
    tray.onClick((event) => {
      if (event.seq_id === 0) this.open();
      if (event.seq_id === 1) this.onQuit();
    });
    tray.onExit(() => {
      if (!this.stopping) this.onQuit();
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Tray startup timed out")), 15000);
      tray.onReady(() => {
        clearTimeout(timeout);
        resolve();
      });
      tray.onError((error) => {
        clearTimeout(timeout);
        reject(error);
        if (!this.stopping) this.onQuit();
      });
    });
    this.open();
  }

  open() {
    if (this.stopping || this.window) return;
    const child = this.spawnWindow(process.execPath, [this.windowEntry, "--gpuix-window"], {
      env: { ...process.env, GPU_UIX_WINDOW_STATUS: JSON.stringify(this.status) },
      stdio: "inherit",
    });
    this.window = child;
    child.once("exit", () => {
      if (this.window === child) this.window = null;
    });
    child.once("error", () => {
      if (this.window === child) this.window = null;
    });
  }

  stop() {
    if (this.stopping) return;
    this.stopping = true;
    this.window?.kill();
    this.tray?.kill(false);
  }
}
