// Local CLI token for the native shell.
//
// The gateway accepts `x-9r-cli-token` for local API access (dashboardGuard:
// canAccessLocalOnlyRoute / hasValidCliToken). The token is derived in
// src/shared/utils/machineId.js from the persisted machine id and a random CLI
// secret both stored in the data directory. The shell must agree with the
// gateway, so it reads the same files and applies the same hash; if they do not
// exist yet it creates them with the module's own fallbacks (the gateway reads
// the file first, so a value written here wins).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CLI_AUTH_SALT = "9r-cli-auth";

function readTrimmed(file) {
  try {
    const value = fs.readFileSync(file, "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
}

function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { mode: 0o600 });
}

// Returns the CLI token, or null when `createIfMissing` is false and the
// identity files are not present yet.
export function readCliToken(dataDir, { createIfMissing = true } = {}) {
  const machineFile = path.join(dataDir, "machine-id");
  const secretFile = path.join(dataDir, "auth", "cli-secret");

  let rawId = readTrimmed(machineFile);
  if (!rawId) {
    if (!createIfMissing) return null;
    rawId = crypto.randomUUID();
    try {
      writePrivate(machineFile, rawId);
    } catch {
      return null;
    }
  }

  let secret = readTrimmed(secretFile);
  if (!secret) {
    if (!createIfMissing) return null;
    secret = crypto.randomBytes(32).toString("hex");
    try {
      writePrivate(secretFile, secret);
    } catch {
      return null;
    }
  }

  return crypto
    .createHash("sha256")
    .update(rawId + CLI_AUTH_SALT + secret)
    .digest("hex")
    .slice(0, 16);
}
