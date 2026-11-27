import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCliToken } from "../src/cli-token.mjs";

const dirs = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpuix-cli-token-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("readCliToken", () => {
  it("creates the identity files and returns the gateway's 16-hex token", () => {
    const dataDir = tempDir();
    const token = readCliToken(dataDir);

    expect(token).toMatch(/^[0-9a-f]{16}$/);
    const machineId = fs.readFileSync(path.join(dataDir, "machine-id"), "utf8").trim();
    const secret = fs.readFileSync(path.join(dataDir, "auth", "cli-secret"), "utf8").trim();
    const expected = crypto
      .createHash("sha256")
      .update(machineId + "9r-cli-auth" + secret)
      .digest("hex")
      .slice(0, 16);
    expect(token).toBe(expected);
  });

  it("returns the same token on later calls and keeps existing files", () => {
    const dataDir = tempDir();
    const first = readCliToken(dataDir);
    const machineId = fs.readFileSync(path.join(dataDir, "machine-id"), "utf8").trim();

    const second = readCliToken(dataDir);
    expect(second).toBe(first);
    expect(fs.readFileSync(path.join(dataDir, "machine-id"), "utf8").trim()).toBe(machineId);
  });

  it("derives from files the gateway already wrote", () => {
    const dataDir = tempDir();
    fs.mkdirSync(path.join(dataDir, "auth"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "machine-id"), "known-machine\n");
    fs.writeFileSync(path.join(dataDir, "auth", "cli-secret"), "secret-value\n");

    const expected = crypto
      .createHash("sha256")
      .update("known-machine" + "9r-cli-auth" + "secret-value")
      .digest("hex")
      .slice(0, 16);
    expect(readCliToken(dataDir)).toBe(expected);
  });

  it("returns null without creating files when createIfMissing is false", () => {
    const dataDir = tempDir();
    expect(readCliToken(dataDir, { createIfMissing: false })).toBeNull();
    expect(fs.existsSync(path.join(dataDir, "machine-id"))).toBe(false);
  });
});
