// Runtime proof that the staged gateway stayed inside its isolated data dir.
//
// config.mjs validates paths before spawn. This module inspects the filesystem
// AFTER the gateway ran, so a fallback inside the gateway (its own DATA_DIR
// resolver, a mis-set env var, a hardcoded %APPDATA%\9router) shows up as a
// failure instead of passing silently.
import fs from "node:fs";
import path from "node:path";

// Files the gateway writes into its OWN data dir. Finding one of these that was
// not there before means a hardcoded path resolved to the installed app's dir.
const SHARED_SENTINELS = ["db.json", "usage.json", "log.txt", "jwt-secret", "machine-id"];

// Snapshot the installed app's data dir, ignoring what is already there. Only
// names+sizes+mtime are recorded, never file contents, so no credential ever
// reaches a test report.
export function snapshotSharedData(sharedDataDir) {
  try {
    const files = fs.readdirSync(sharedDataDir, { recursive: true, withFileTypes: true });
    return files
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
      .map((file) => {
        const stat = fs.statSync(file, { throwIfNoEntry: false });
        return stat ? `${path.relative(sharedDataDir, file)}:${stat.size}:${stat.mtimeMs}` : null;
      })
      .filter(Boolean)
      .sort();
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

export function snapshotDir(dir) {
  return snapshotSharedData(dir);
}

// Snapshot entries are "<relative path>:<size>:<mtime>". Only the path part is
// meaningful for "what appeared", so compare on that and never on the format.
function entryPath(entry) {
  return entry.replace(/:(\d+):[\d.]+$/, "");
}

/**
 * Asserts the gateway used the isolated dir and left the shared one alone.
 * @throws Error listing every violation found.
 */
export function assertIsolationHeld({ isolation, sharedDataDir, sharedBefore }) {
  const violations = [];

  const after = snapshotSharedData(sharedDataDir);
  if (sharedBefore) {
    const known = new Set(sharedBefore.map(entryPath));
    const added = after.filter((entry) => !known.has(entryPath(entry)));
    if (added.length) {
      violations.push(
        `installed app data dir gained ${added.length} file(s): ${added.map(entryPath).slice(0, 5).join(", ")}`
      );
    }
  }

  // The gateway must have created state in the isolated dir.
  const isolatedFiles = snapshotDir(isolation.dataDir);
  if (!isolatedFiles.some((entry) => entry.startsWith(`db${path.sep}`) || entry.startsWith("db/"))) {
    violations.push(`isolated data dir ${isolation.dataDir} has no db/ (gateway did not initialize there)`);
  }

  // Nothing may be created inside the shared dir as a side effect of the
  // gateway's own hardcoded paths (mitm dir, update dir, jwt secret, ...).
  if (sharedBefore) {
    const known = new Set(sharedBefore.map(entryPath));
    for (const sentinel of SHARED_SENTINELS) {
      if (fs.existsSync(path.join(sharedDataDir, sentinel)) && !known.has(sentinel)) {
        violations.push(`installed app data dir contains ${sentinel} written during this run`);
      }
    }
  }

  if (violations.length) {
    throw new Error(`Isolation violated: ${violations.join("; ")}`);
  }
}

// The experimental process must never be able to resolve the installed app's
// install dir either; used by the packaging/install feature later.
export function assertNotInstalledAppPath(candidate, shared) {
  const rel = path.relative(shared.installDir, candidate);
  const inside = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  if (inside) {
    throw new Error(`${candidate} is inside the installed application (${shared.installDir}).`);
  }
}
