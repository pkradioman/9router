// Activation guard for the window process.
//
// The tray sends `gpuix-activate` to the window child. A message can arrive
// while the window is closing: the native window may already be destroyed, and
// calling into the renderer then raises "invalid window handle". The renderer
// tells us when the last window closed (`requiresTick() === false`), so act only
// while it is alive; otherwise let the window process end and let the tray spawn
// a fresh one on the next click (Electron parity: close keeps the tray).
export function activateIfAlive(renderer) {
  if (!renderer) return "terminated";
  try {
    if (typeof renderer.isInitialized === "function" && !renderer.isInitialized()) return "terminated";
    if (typeof renderer.requiresTick === "function" && renderer.requiresTick() === false) return "terminated";
    renderer.activateWindow();
    return "activated";
  } catch {
    // A destroyed native window throws from inside the renderer; the caller
    // exits the window process instead of retrying.
    return "terminated";
  }
}
