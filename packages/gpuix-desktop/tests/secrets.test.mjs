import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SECRETS_FILE_NAME, loadOrCreateSecrets, redactSecrets } from "../src/secrets.mjs";

const temps = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpuix-secrets-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("loadOrCreateSecrets", () => {
  it("generates non-default high-entropy secrets", () => {
    const secrets = loadOrCreateSecrets(tempDir());
    expect(secrets.initialPassword).not.toBe("123456");
    expect(secrets.initialPassword.length).toBeGreaterThanOrEqual(16);
    expect(secrets.apiKeySecret).not.toBe("endpoint-proxy-api-key-secret");
    expect(new Set([secrets.jwtSecret, secrets.apiKeySecret, secrets.machineIdSalt]).size).toBe(3);
  });

  it("reuses the same secrets on the next launch so stored sessions survive", () => {
    const dir = tempDir();
    const first = loadOrCreateSecrets(dir);
    const second = loadOrCreateSecrets(dir);
    expect(second.jwtSecret).toBe(first.jwtSecret);
    expect(second.apiKeySecret).toBe(first.apiKeySecret);
    expect(second.initialPassword).toBe(first.initialPassword);
  });

  it("writes the secret file into the isolated data directory", () => {
    const dir = tempDir();
    loadOrCreateSecrets(dir);
    expect(fs.existsSync(path.join(dir, SECRETS_FILE_NAME))).toBe(true);
  });

  it("fails closed on an incomplete secret file rather than silently rotating", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, SECRETS_FILE_NAME), JSON.stringify({ jwtSecret: "short" }));
    expect(() => loadOrCreateSecrets(dir)).toThrow(/incomplete/);
  });
});

describe("redactSecrets", () => {
  it("removes every secret value from log text", () => {
    const secrets = loadOrCreateSecrets(tempDir());
    const line = `pw=${secrets.initialPassword} jwt=${secrets.jwtSecret} api=${secrets.apiKeySecret} salt=${secrets.machineIdSalt}`;
    const redacted = redactSecrets(line, secrets);
    expect(redacted).toBe("pw=[redacted] jwt=[redacted] api=[redacted] salt=[redacted]");
  });
});
