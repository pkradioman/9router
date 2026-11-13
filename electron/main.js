const { app, BrowserWindow, Tray, Menu, shell, nativeImage } = require("electron");
const path = require("node:path");
const net = require("node:net");

const PREFERRED_PORT = 20128;
const HEALTH_TIMEOUT_MS = 60_000;

const serverDir = app.isPackaged
  ? path.join(process.resourcesPath, "app")
  : path.join(__dirname, "..", ".next-cli-build", "standalone");

let win = null;
let tray = null;
let port = PREFERRED_PORT;
let quitting = false;

function portFree(p) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(p, "127.0.0.1");
  });
}

async function pickPort() {
  if (await portFree(PREFERRED_PORT)) return PREFERRED_PORT;
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port: free } = srv.address();
      srv.close(() => resolve(free));
    });
  });
}

function startServer(p) {
  // The Next standalone entrypoint reads PORT/HOSTNAME and chdirs itself.
  // DATA_DIR is left alone so the desktop app shares %APPDATA%\9router with the CLI.
  process.env.NODE_ENV = "production";
  process.env.PORT = String(p);
  process.env.HOSTNAME = "127.0.0.1";
  require(path.join(serverDir, "server.js"));
}

async function waitForHealth(p, deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${p}/api/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    show: false,
    backgroundColor: "#0b0b0c",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadURL(`http://127.0.0.1:${port}/dashboard`);
  win.once("ready-to-show", () => win.show());
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });
}

function createTray() {
  const iconPath = path.join(__dirname, "icon.png");
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip(`9Router — port ${port}`);
  const menu = Menu.buildFromTemplate([
    { label: `9Router (port ${port})`, enabled: false },
    { label: "Open Dashboard", click: () => (win ? (win.show(), win.focus()) : createWindow()) },
    { label: "Open in Browser", click: () => shell.openExternal(`http://127.0.0.1:${port}/dashboard`) },
    { type: "separator" },
    { label: "Auto-start at login", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }) },
    { type: "separator" },
    { label: "Quit 9Router", click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on("double-click", () => { if (win) { win.show(); win.focus(); } else createWindow(); });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return createWindow();
    win.show();
    win.focus();
  });

  app.whenReady().then(async () => {
    port = await pickPort();
    startServer(port);
    const healthy = await waitForHealth(port, Date.now() + HEALTH_TIMEOUT_MS);
    if (!healthy) {
      const { dialog } = require("electron");
      dialog.showErrorBox("9Router", `The gateway did not start on port ${port}.`);
      quitting = true;
      return app.quit();
    }
    createWindow();
    createTray();

    app.on("activate", () => {
      if (!win) createWindow();
      else win.show();
    });
  });

  // Keep running in the tray when the window closes.
  app.on("window-all-closed", () => {});
  app.on("before-quit", () => { quitting = true; });
}
