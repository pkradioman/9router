const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function startTray(platform) {
  const source = fs.readFileSync(path.join(__dirname, "../electron/main.js"), "utf8");
  const start = source.indexOf("function createTray()");
  const end = source.indexOf("\nfunction quit()", start);
  assert.ok(start >= 0 && end > start);
  let instance;
  let shown = 0;
  let focused = 0;
  class Tray {
    constructor() {
      this.events = {};
      instance = this;
    }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; }
    popUpContextMenu(menu) { this.popup = menu; }
    on(name, handler) { this.events[name] = handler; }
  }
  const icon = { isEmpty: () => false, getSize: () => ({ width: 32, height: 32 }) };
  const context = {
    process: { platform },
    Tray,
    tray: null,
    trayIconPath: () => "icon.png",
    nativeImage: { createFromPath: () => icon },
    Menu: { buildFromTemplate: (items) => items },
    app: { getLoginItemSettings: () => ({}), setLoginItemSettings() {} },
    shell: { openExternal() {} },
    win: { show: () => shown++, focus: () => focused++ },
    createWindow() {},
    quit() {},
    logLine() {},
    port: 20128,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(`${source.slice(start, end)}\ncreateTray();`, context);
  return { tray: instance, shown: () => shown, focused: () => focused };
}

test("Linux exports its tray menu and restores the window on activation", () => {
  const { tray, shown, focused } = startTray("linux");
  assert.ok(tray.menu, "Linux must export a tray context menu");
  assert.ok(tray.menu.some((item) => item.label === "Open Dashboard"));
  assert.ok(tray.menu.some((item) => item.label === "Quit 9Router"));
  tray.events.click();
  assert.equal(shown(), 1);
  assert.equal(focused(), 1);
});

test("Windows retains its explicit right-click menu and double-click restore", () => {
  const { tray, shown, focused } = startTray("win32");
  assert.equal(tray.menu, undefined);
  tray.events["right-click"]();
  assert.ok(tray.popup.some((item) => item.label === "Open Dashboard"));
  tray.events["double-click"]();
  assert.equal(shown(), 1);
  assert.equal(focused(), 1);
});
