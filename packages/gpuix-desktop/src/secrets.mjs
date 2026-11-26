// Per-instance secrets for the experimental gateway.
//
// The gateway's defaults are shared constants (INITIAL_PASSWORD "123456",
// API_KEY_SECRET a fixed string), which would be unsafe on a LAN-bound port.
// Generate high-entropy replacements once, keep them inside the isolated data
// directory, and never log their values.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SECRETS_FILE_NAME = "experimental-secrets.json";

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

function newSecrets() {
  return {
    version: 1,
    initialPassword: crypto.randomBytes(24).toString("base64url"),
    jwtSecret: randomHex(32),
    apiKeySecret: randomHex(32),
    machineIdSalt: randomHex(16),
  };
}

function isValid(parsed) {
  return (
    parsed &&
    typeof parsed === "object" &&
    typeof parsed.initialPassword === "string" &&
    parsed.initialPassword.length >= 16 &&
    typeof parsed.jwtSecret === "string" &&
    parsed.jwtSecret.length >= 32 &&
    typeof parsed.apiKeySecret === "string" &&
    parsed.apiKeySecret.length >= 32 &&
    typeof parsed.machineIdSalt === "string" &&
    parsed.machineIdSalt.length >= 16
  );
}

export function loadOrCreateSecrets(dataDir) {
  const file = path.join(dataDir, SECRETS_FILE_NAME);
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isValid(parsed)) {
      throw new Error(`${file} is present but incomplete; delete it to rotate the experimental credentials.`);
    }
    return { ...parsed, file };
  }
  const secrets = newSecrets();
  fs.writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows ACLs ignore POSIX modes; the file already lives in a per-user dir.
  }
  return { ...secrets, file };
}

// Secrets are written once and reused, so two launches cannot diverge and the
// shell can log in to its own gateway after a restart.
export function redactSecrets(value, secrets) {
  let text = String(value ?? "");
  for (const secret of [secrets.initialPassword, secrets.jwtSecret, secrets.apiKeySecret, secrets.machineIdSalt]) {
    if (typeof secret === "string" && secret.length > 0) text = text.split(secret).join("[redacted]");
  }
  return text;
}
