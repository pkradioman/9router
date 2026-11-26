// Safety gates for the experimental desktop shell (NINEROUTER_GPU_UIX=1).
//
// The stock gateway exposes update/shutdown routes that kill processes by
// command-line match and then run `npm i -g 9router@latest`. On a machine that
// also runs the installed app that would kill the installed app, its tray and
// its MITM server, then rewrite the globally installed package. The experimental
// build must never be able to do that, so those routes are refused before any
// handler runs (dashboardGuard) and the helpers refuse even when reached from a
// different call site (appUpdater).
//
// The gate is keyed on an env var the installed app never sets, so shipped
// behavior is unchanged. When the experimental desktop grows its own update and
// quit flows (desktop-lifecycle), they must replace this block instead of
// removing it.

export const EXPERIMENTAL_BLOCKED_PATHS = [
  "/api/version/update",
  "/api/version/shutdown",
  "/api/shutdown",
];

export const EXPERIMENTAL_BLOCK_MESSAGE =
  "Disabled in the experimental desktop build: it would update or kill the installed application. Use the experimental desktop's own lifecycle controls.";

export function isExperimentalMode(env = process.env) {
  return env.NINEROUTER_GPU_UIX === "1";
}

// Returns the blocked prefix that matches pathname, or null.
export function blockedExperimentalPath(pathname, env = process.env) {
  if (!isExperimentalMode(env)) return null;
  if (typeof pathname !== "string" || pathname === "") return null;
  return EXPERIMENTAL_BLOCKED_PATHS.find((p) => pathname === p || pathname.startsWith(`${p}/`)) || null;
}
