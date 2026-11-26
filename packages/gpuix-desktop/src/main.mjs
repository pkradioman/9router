// Entry point for the experimental native shell.
//
// Boot order matters: validate isolation, refuse an occupied port, start the
// supervised gateway, wait for health, and only then create the window. If any
// step fails the process exits non-zero without touching the installed app's
// data or port.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gatewayEnv, resolveIsolation, resolvePort, IsolationError, PortConflictError } from "./config.mjs";
import { loadOrCreateSecrets } from "./secrets.mjs";
import { GatewaySupervisor, resolveRuntimeDir } from "./gateway-supervisor.mjs";
import { initialStatus, refreshStatus } from "./ui/status-model.mjs";
import { checkExperimentalRouteBlocks, summarize } from "./security-check.mjs";
import { TrayController } from "./tray-controller.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function logBoot(message, detail) {
  const line = detail === undefined ? message : `${message} ${detail}`;
  console.error(`[gpuix-desktop] ${line}`);
}

function writeBootRecord(logDir, record) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, "desktop.log"), `${new Date().toISOString()} ${JSON.stringify(record)}\n`, {
      flag: "a",
    });
  } catch {
    // Boot records are diagnostic only.
  }
}

export async function boot({ env = process.env, headless = false } = {}) {
  const isolation = resolveIsolation({ env });
  const port = resolvePort(env);
  const secrets = loadOrCreateSecrets(isolation.dataDir);
  const runtimeDir = resolveRuntimeDir({ env, packageRoot });

  logBoot("isolated", `dataDir=${isolation.dataDir} port=${port}`);

  const supervisor = new GatewaySupervisor({
    runtimeDir,
    port,
    logDir: isolation.logDir,
    secrets,
    env: gatewayEnv({ isolation, port, secrets, runtimeDir, env }),
  });

  const health = await supervisor.start();

  // The staged gateway must not expose self-update / cross-process kill routes.
  // Check once per boot so a stale runtime is caught before the window opens.
  const guard = summarize(await checkExperimentalRouteBlocks({ baseUrl: `http://127.0.0.1:${port}` }));
  if (guard.failures.length) {
    await supervisor.stop();
    throw new IsolationError(
      `Experimental route guard failed (${guard.failures
        .map((f) => `${f.name}=${f.status}`)
        .join(", ")}). The staged runtime predates the safety build; restage it with "npm run desktop:stage".`,
      { failures: guard.failures }
    );
  }

  const status = initialStatus({ port, dataDir: isolation.dataDir, runtimeDir });
  const next = await refreshStatus(status);
  writeBootRecord(isolation.logDir, {
    event: "booted",
    port,
    dataDir: isolation.dataDir,
    runtimeDir,
    health,
    version: next.version,
  });

  return { supervisor, status: next, isolation, port, runtimeDir, headless };
}

async function shutdown(supervisor, code) {
  try {
    await supervisor.stop();
  } finally {
    process.exit(code);
  }
}

async function main() {
  if (process.argv.includes("--gpuix-window")) {
    await showWindow(JSON.parse(process.env.GPU_UIX_WINDOW_STATUS));
    return;
  }
  const headless = process.env.NINEROUTER_GPU_UIX_HEADLESS === "1";
  let session;
  try {
    session = await boot({ headless });
  } catch (error) {
    if (error instanceof PortConflictError) {
      logBoot(error.message);
    } else if (error instanceof IsolationError) {
      logBoot("isolation check failed:", error.message);
    } else {
      logBoot("gateway failed to start:", error && (error.message || String(error)));
    }
    process.exit(1);
  }

  const { supervisor, status, isolation } = session;

  // Installed before any window exists: GPUIX exits the process when the
  // window loop ends, and this hook is what stops the gateway on that path.
  supervisor.installExitGuard();

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      logBoot(`${signal} received, stopping gateway`);
      void shutdown(supervisor, 0);
    });
  }
  supervisor.child?.once("exit", (code) => {
    if (supervisor.stopping) return;
    logBoot("gateway exited unexpectedly", `code=${code}`);
    void shutdown(supervisor, 1);
  });

  if (headless) {
    logBoot("headless mode: gateway healthy, no window created");
    console.log(
      JSON.stringify({
        event: "ready",
        port: status.port,
        baseUrl: status.baseUrl,
        dataDir: isolation.dataDir,
        version: status.version,
      })
    );
    return;
  }

  const systray = await import("systray");
  const SysTray = systray.default.default || systray.default;
  const icon = fs.readFileSync(path.join(packageRoot, "dist", "icon.ico")).toString("base64");
  let closing = false;
  const controller = new TrayController({
    createTray: (options) => new SysTray(options),
    icon,
    windowEntry: process.argv[1],
    status,
    onQuit: () => {
      if (closing) return;
      closing = true;
      controller.stop();
      void shutdown(supervisor, 0);
    },
  });
  process.on("exit", () => controller.stop());
  try {
    await controller.start();
  } catch (error) {
    controller.stop();
    await supervisor.stop();
    throw error;
  }
}

async function showWindow(status) {
  const React = (await import("react")).default;
  const { render } = await import("@gpuix/react");
  const { StatusPanel } = await import("./ui/StatusPanel.mjs");

  const h = React.createElement;
  function App() {
    const [current, setCurrent] = React.useState(status);
    const onRefresh = React.useCallback(() => {
      setCurrent((prev) => ({ ...prev, phase: "connecting", lastError: null }));
      void refreshStatus(current).then(setCurrent);
    }, [current]);
    return h(StatusPanel, { status: current, onRefresh });
  }

  logBoot("creating window");
  render(h(App), { title: "9Router (Experimental)", width: 1080, height: 720, focus: true, show: true });
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    logBoot("unhandled boot failure:", error && (error.message || String(error)));
    process.exit(1);
  });
}
