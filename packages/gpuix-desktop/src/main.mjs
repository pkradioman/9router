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
import { createActivationToken, loadOrCreateSecrets } from "./secrets.mjs";
import { GatewaySupervisor, resolveRuntimeDir } from "./gateway-supervisor.mjs";
import { initialStatus, refreshStatus } from "./ui/status-model.mjs";
import { TrayController } from "./tray-controller.mjs";
import { assertRuntimeGuard } from "./runtime-guard.mjs";
import { checkExperimentalRouteBlocks, summarize } from "./security-check.mjs";
import { askForPort } from "./port-prompt.mjs";
import { acquireSingleInstance } from "./single-instance.mjs";
import { runFirstImport, DEFAULT_SOURCE_URL } from "./import-client.mjs";
import { activateIfAlive } from "./window-lifecycle.mjs";
import { readCliToken } from "./cli-token.mjs";

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

export async function boot({
  env = process.env,
  headless = false,
  onPortLost = null,
  verifyBlockedRoutes = true,
  importPassword = null,
  importSourceUrl = null,
  fetchImpl = fetch,
} = {}) {
  const isolation = resolveIsolation({ env });
  const port = resolvePort(env);
  const secrets = loadOrCreateSecrets(isolation.dataDir);
  const runtimeDir = resolveRuntimeDir({ env, packageRoot });
  // Cheap pre-check: the staged files must carry the experimental marker.
  assertRuntimeGuard(runtimeDir);

  logBoot("isolated", `dataDir=${isolation.dataDir} port=${port}`);

  // Before the gateway starts: seed the isolated DB from the installed app's own
  // snapshot. Runs at most once (marker) and fails closed — a failed import
  // leaves no DB and no marker, and the shell exits instead of booting empty.
  let importResult = null;
  if (importPassword) {
    try {
      importResult = await runFirstImport({
        dataDir: isolation.dataDir,
        password: importPassword,
        baseUrl: importSourceUrl || DEFAULT_SOURCE_URL,
        fetchImpl,
        log: (message, detail) => logBoot(message, detail),
      });
    } catch (error) {
      throw new IsolationError(`Database import failed: ${error?.message || error}`, { port });
    }
  }

  const supervisor = new GatewaySupervisor({
    runtimeDir,
    port,
    logDir: isolation.logDir,
    secrets,
    env: gatewayEnv({ isolation, port, secrets, runtimeDir, env }),
    onPortLost: (error) => onPortLost?.(error, supervisor),
  });

  const health = await supervisor.start();

  // Live proof, not just the marker grep above: one bounded POST per blocked
  // path against the running gateway. The routes must answer 401/403 before
  // the window opens, otherwise a stale runtime could expose self-update or
  // cross-process kill. These are local gateway routes and never reach a
  // provider. The marker check stays as a cheap pre-check, not the only
  // enforcement.
  //
  // `verifyBlockedRoutes: false` exists for fake-runtime harnesses that cannot
  // serve the Next.js routes; it logs loudly and is never used by main().
  if (verifyBlockedRoutes) {
    let guard;
    try {
      guard = summarize(await checkExperimentalRouteBlocks({ baseUrl: `http://127.0.0.1:${port}` }));
    } catch (error) {
      await supervisor.stop();
      throw new IsolationError(
        `Experimental route guard could not run: ${error && (error.message || String(error))}`,
        { port }
      );
    }
    if (guard.failures.length) {
      await supervisor.stop();
      throw new IsolationError(
        `Experimental route guard failed (${guard.failures
          .map((f) => `${f.name}=${f.status}`)
          .join(", ")}). The staged runtime predates the safety build; restage it with "npm run desktop:stage".`,
        { failures: guard.failures }
      );
    }
    logBoot("experimental route guard passed", `${guard.passed}/${guard.total} blocked routes refused`);
  } else {
    logBoot("experimental route guard skipped by explicit option; marker pre-check only");
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

  return { supervisor, status: next, isolation, port, runtimeDir, headless, importResult };
}

async function shutdown(supervisor, code) {
  try {
    await supervisor.stop();
  } finally {
    process.exit(code);
  }
}

async function readPasswordLine() {
  if (process.stdin.isTTY) {
    logBoot("reading the installed app password from stdin; it will be echoed in a terminal — pipe it instead");
  }
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
    if (chunks.reduce((n, c) => n + c.length, 0) > 4096) break;
  }
  const line = Buffer.concat(chunks).toString("utf8").split(/\r?\n/, 1)[0];
  if (!line) throw new IsolationError("No password was provided on stdin for --gpuix-import.");
  return line;
}

async function main() {
  if (process.argv.includes("--gpuix-window")) {
    await showWindow(JSON.parse(process.env.GPU_UIX_WINDOW_STATUS));
    return;
  }
  if (process.argv.includes("--gpuix-port-prompt")) {
    await showPortPrompt(Number(process.env.GPU_UIX_CONFLICT_PORT));
    return;
  }
  const headless = process.env.NINEROUTER_GPU_UIX_HEADLESS === "1";
  const identityIsolation = resolveIsolation({ env: process.env });
  const identity = fs.realpathSync(identityIsolation.dataDir);
  // Activation is token-gated: the pipe is reachable by any local process, so
  // both launches prove they share this user's experimental secrets store.
  const secrets = loadOrCreateSecrets(identityIsolation.dataDir);
  const activationToken = createActivationToken(secrets);
  let controller;
  let pendingActivation = false;
  const instance = await acquireSingleInstance(identity, () => {
    if (controller) controller.open();
    else pendingActivation = true;
  }, {
    activationToken,
    secrets,
    log: (message) => logBoot(message),
  });
  if (!instance.primary) return;
  let session;
  let env = process.env;
  const importPassword = process.argv.includes("--gpuix-import") ? await readPasswordLine() : null;
  const importSourceUrl = process.env.GPU_UIX_IMPORT_FROM || null;
  const onPortLost = (error, supervisor) => {
    logBoot("port ownership lost:", error.message);
    void shutdown(supervisor, 1);
  };
  while (!session) {
    try {
      session = await boot({ env, headless, onPortLost, importPassword, importSourceUrl });
    } catch (error) {
      if (error instanceof PortConflictError) {
        logBoot(error.message);
        if (!headless) {
          const port = await askForPort({ entry: process.argv[1], occupiedPort: error.port });
          if (port === null) {
            await instance.close();
            return;
          }
          env = { ...env, NINEROUTER_GPU_UIX_PORT: String(port) };
          continue;
        }
      } else if (error instanceof IsolationError) {
        logBoot("isolation check failed:", error.message);
      } else {
        logBoot("gateway failed to start:", error && (error.message || String(error)));
      }
      process.exit(1);
    }
  }

  const { supervisor, status, isolation, importResult } = session;

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
        import: importResult?.status ?? null,
      })
    );
    return;
  }

  const systray = await import("systray");
  const SysTray = systray.default.default || systray.default;
  const icon = fs.readFileSync(path.join(packageRoot, "dist", "icon.ico")).toString("base64");
  // Local dashboard APIs accept this token, so the native pages work without a
  // password prompt (GPUIX has no masked input yet).
  const cliToken = readCliToken(isolation.dataDir);
  let closing = false;
  controller = new TrayController({
    createTray: (options) => new SysTray(options),
    icon,
    windowEntry: process.argv[1],
    status,
    cliToken,
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
    if (pendingActivation) controller.open();
  } catch (error) {
    controller.stop();
    await supervisor.stop();
    throw error;
  }
}

async function showPortPrompt(occupiedPort) {
  const React = (await import("react")).default;
  const { render } = await import("@gpuix/react");
  const { PortConflict } = await import("./ui/PortConflict.mjs");
  render(React.createElement(PortConflict, {
    occupiedPort,
    onChoose: (port) => {
      if (process.send) process.send({ type: "gpuix-port-choice", port }, () => process.exit(0));
      else process.exit(1);
    },
    onCancel: () => process.exit(0),
  }), { title: "9Router Experimental - Port Conflict", width: 600, height: 320, focus: true, show: true });
}

async function showWindow(status) {
  const React = (await import("react")).default;
  const { render, useGpuix } = await import("@gpuix/react");
  const { App } = await import("./ui/App.mjs");
  const { createGatewayApi } = await import("./ui/api.mjs");
  const api = createGatewayApi({ baseUrl: status.baseUrl, token: process.env.GPU_UIX_CLI_TOKEN || null });

  let activate;
  let pendingActivation = false;
  process.on("message", (message) => {
    if (message?.type !== "gpuix-activate") return;
    if (activate) activate();
    else pendingActivation = true;
  });
  const h = React.createElement;
  function Shell() {
    const [current, setCurrent] = React.useState(status);
    const { renderer } = useGpuix();
    React.useEffect(() => {
      if (!renderer) return;
      activate = () => {
        if (activateIfAlive(renderer) === "terminated") process.exit(0);
      };
      if (pendingActivation) {
        pendingActivation = false;
        activate();
      }
      return () => { activate = null; };
    }, [renderer]);
    const onRefresh = React.useCallback(() => {
      setCurrent((prev) => ({ ...prev, phase: "connecting", lastError: null }));
      void refreshStatus(current).then(setCurrent);
    }, [current]);
    return h(App, { api, status: current, onRefresh });
  }

  logBoot("creating window");
  render(h(Shell), { title: "9Router (Experimental)", width: 1080, height: 720, focus: true, show: true });
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    logBoot("unhandled boot failure:", error && (error.message || String(error)));
    process.exit(1);
  });
}
