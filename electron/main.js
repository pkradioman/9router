const { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");

const PREFERRED_PORT = 20128;
const HEALTH_TIMEOUT_MS = 60_000;

const serverDir = app.isPackaged
  ? path.join(process.resourcesPath, "app", "runtime")
  : path.join(__dirname, "..", "desktop-app", "runtime");

// Chromium writes Cache/GPUCache/Local Storage next to userData; keep that out
// of the gateway's data dir (%APPDATA%\9router), which the CLI also owns. The
// gateway resolves its own DATA_DIR from APPDATA, so the DB stays shared.
app.setPath("userData", path.join(app.getPath("appData"), "9router", "desktop"));

function logLine(...parts) {
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "desktop.log"), `${new Date().toISOString()} ${parts.join(" ")}\n`);
  } catch {}
}

// Next writes prerendered HTML/RSC into <dist>/server/route-cache, inside the
// install dir. That cache survives upgrades, so after an update the server can
// keep serving pages that reference the PREVIOUS build's chunks - the dashboard
// then runs the old UI and shows the old version. Clear it when BUILD_ID moves.
function clearStaleRouteCache() {
  try {
    const distDir = path.join(serverDir, "desktop-dist");
    const buildId = fs.readFileSync(path.join(distDir, "BUILD_ID"), "utf8").trim();
    const markerPath = path.join(app.getPath("userData"), "route-cache-build-id");
    const previous = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, "utf8").trim() : "";
    if (!buildId || previous === buildId) return;
    fs.rmSync(path.join(distDir, "server", "route-cache"), { recursive: true, force: true });
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, buildId);
    logLine("route cache cleared for new build", buildId);
  } catch (err) {
    logLine("route cache check failed", err && (err.message || String(err)));
  }
}

process.on("uncaughtException", (err) => {
  logLine("uncaughtException", err && (err.stack || err.message || String(err)));
  dialog.showErrorBox("9Router", String(err && (err.stack || err.message || err)));
  app.exit(1);
});

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
  clearStaleRouteCache();
  process.env.NODE_ENV = "production";
  process.env.PORT = String(p);
  // Bind all interfaces like the CLI launcher does (DEFAULT_HOST = 0.0.0.0);
  // LAN clients point at this gateway, so 127.0.0.1 would silently cut them off.
  process.env.HOSTNAME = "0.0.0.0";
  try {
    // custom-server.js wraps http.createServer to stamp the real peer address and
    // its proof token; without it every request looks remote, which makes the
    // dashboard reject the default password and rate-limits on the wrong key.
    require(path.join(serverDir, "custom-server.js"));
    require(path.join(serverDir, "server.js"));
    logLine("server require ok", `port=${p}`, `dir=${serverDir}`);
  } catch (err) {
    logLine("server require failed", err && (err.stack || err.message));
    throw err;
  }
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

function appIconPath() {
  // Windows takes the multi-size .ico for the window/taskbar; other platforms
  // get the 512px PNG.
  return path.join(__dirname, process.platform === "win32" ? "icon.ico" : "icon.png");
}

function trayIconPath() {
  // Windows renders tray icons at 16-32px; handing it a 256px bitmap and
  // letting it downscale loses the strokes, so ship a native-size render.
  return path.join(__dirname, "tray.png");
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    show: false,
    icon: appIconPath(),
    backgroundColor: "#0b0b0c",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadURL(`http://127.0.0.1:${port}/dashboard`);
  win.once("ready-to-show", () => win.show());
  win.on("close", (event) => {
    // Hide to the tray only when there is a tray to restore from; otherwise the
    // window would become unreachable with no way to quit.
    if (quitting || !tray) return;
    event.preventDefault();
    win.hide();
  });
}

function createTray() {
  const iconFile = trayIconPath();
  const icon = nativeImage.createFromPath(iconFile);
  const size = icon.isEmpty() ? null : icon.getSize();
  logLine("tray icon", iconFile, size ? `${size.width}x${size.height}` : "EMPTY");
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip(`9Router — port ${port}`);
  const menu = Menu.buildFromTemplate([
    { label: `9Router (port ${port})`, enabled: false },
    { label: "Open Dashboard", click: () => (win ? (win.show(), win.focus()) : createWindow()) },
    { label: "Open in Browser", click: () => shell.openExternal(`http://127.0.0.1:${port}/dashboard`) },
    { type: "separator" },
    { label: "Auto-start at login", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }) },
    { type: "separator" },
    { label: "Quit 9Router", click: quit },
  ]);
  // Drive the menu from our own click handlers instead of relying on the
  // platform default: on Windows the default path is tied to the tray's owner
  // window and silently does nothing when that window is not in the foreground.
  // popUpContextMenu works regardless.
  //
  // The single-click path is debounced so a double-click does not open the menu
  // under the cursor and have its second half land on a menu item (Quit sits
  // nearest the tray). Double-click still restores the window.
  let clickTimer = null;
  tray.on("click", () => {
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => tray.popUpContextMenu(menu), 260);
  });
  tray.on("right-click", () => {
    clearTimeout(clickTimer);
    tray.popUpContextMenu(menu);
  });
  tray.on("double-click", () => {
    clearTimeout(clickTimer);
    if (win) { win.show(); win.focus(); } else createWindow();
  });
  logLine("tray ready", `port=${port}`);
}

function quit() {
  quitting = true;
  app.quit();
}

// The window has no menu bar (autoHideMenuBar), but its accelerators stay live,
// so Ctrl+Q always quits even if the tray is unreachable.
function createAppMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "File",
        submenu: [{ label: "Quit 9Router", accelerator: "CmdOrCtrl+Q", click: quit }],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
    ])
  );
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
    try {
      startServer(port);
    } catch (err) {
      dialog.showErrorBox("9Router", `The gateway failed to load:\n\n${err && (err.stack || err.message)}`);
      quitting = true;
      return app.quit();
    }
    const healthy = await waitForHealth(port, Date.now() + HEALTH_TIMEOUT_MS);
    if (!healthy) {
      dialog.showErrorBox("9Router", `The gateway did not start on port ${port}. See desktop.log in ${app.getPath("userData")}.`);
      quitting = true;
      return app.quit();
    }
    logLine("healthy", `port=${port}`);
    createAppMenu();
    createWindow();
    createTray();

    app.on("activate", () => {
      if (!win) createWindow();
      else win.show();
    });
  }).catch((err) => {
    logLine("whenReady failed", err && (err.stack || err.message));
    dialog.showErrorBox("9Router", String(err && (err.stack || err.message || err)));
    quitting = true;
    app.quit();
  });

  // Keep running in the tray when the window closes.
  app.on("window-all-closed", () => {});
  app.on("before-quit", () => { quitting = true; });
}
