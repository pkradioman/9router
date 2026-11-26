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

  // Imported lazily so headless runs never load the native renderer.
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
