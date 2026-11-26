import fs from "node:fs";
import path from "path";
import os from "os";

const APP_NAME = "9router";

function defaultDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

export function resolveDataDir(env = process.env) {
  const configured = env.DATA_DIR;
  // Experimental desktop: an unusable DATA_DIR must fail the process. The
  // fallbacks below would otherwise point the experimental gateway at the
  // installed app's data, which the isolation contract forbids.
  const experimental = env.NINEROUTER_GPU_UIX === "1";
  const failClosed = (reason) => {
    if (experimental) {
      throw new Error(
        `[DATA_DIR] ${reason} — refusing to fall back to the installed application's data directory in the experimental build.`
      );
    }
  };

  if (!configured) {
    failClosed("DATA_DIR is not set");
    return defaultDir();
  }

  // On Windows, ignore Unix-style absolute paths (e.g. /var/lib/...) that come
  // from a Linux-targeted .env or Docker config — they are not valid here.
  if (process.platform === "win32" && /^\//.test(configured)) {
    failClosed(`DATA_DIR '${configured}' is a Unix path on Windows`);
    console.warn(`[DATA_DIR] '${configured}' is a Unix path on Windows → fallback to default`);
    return defaultDir();
  }

  try {
    fs.mkdirSync(configured, { recursive: true });
    return configured;
  } catch (e) {
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      failClosed(`DATA_DIR '${configured}' is not writable`);
      console.warn(`[DATA_DIR] '${configured}' not writable → fallback ~/.${APP_NAME}`);
      return defaultDir();
    }
    throw e;
  }
}

export function getDataDir() {
  return resolveDataDir(process.env);
}

export const DATA_DIR = getDataDir();
