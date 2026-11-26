import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertIsolationHeld, assertNotInstalledAppPath, snapshotDir } from "../src/isolation-proof.mjs";

const temps = [];
function tempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpuix-iso-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fakeIsolation(root) {
  const dataDir = path.join(root, "data");
  fs.mkdirSync(path.join(dataDir, "db"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "db", "data.sqlite"), "experimental");
  return { dataDir, logDir: path.join(root, "logs"), cacheDir: path.join(root, "cache") };
}

describe("snapshotDir", () => {
  it("returns an empty list for a missing directory", () => {
    const root = tempRoot();
    expect(snapshotDir(path.join(root, "absent"))).toEqual([]);
  });

  it("records names, sizes and mtimes but never contents", () => {
    const root = tempRoot();
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "jwt-secret"), "super-secret-value");
    const snapshot = snapshotDir(root);
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatch(/^jwt-secret:\d+:/);
    expect(snapshot[0]).not.toContain("super-secret-value");
  });
});

describe("assertIsolationHeld", () => {
  it("passes when the gateway wrote only into the isolated dir", () => {
    const root = tempRoot();
    const isolation = fakeIsolation(root);
    const sharedDataDir = path.join(root, "shared-9router");
    fs.mkdirSync(path.join(sharedDataDir, "db"), { recursive: true });
    fs.writeFileSync(path.join(sharedDataDir, "db", "data.sqlite"), "installed");
    const sharedBefore = snapshotDir(sharedDataDir);

    expect(() => assertIsolationHeld({ isolation, sharedDataDir, sharedBefore })).not.toThrow();
  });

  it("fails when the isolated dir never received a database", () => {
    const root = tempRoot();
    const isolation = { dataDir: path.join(root, "empty"), logDir: path.join(root, "l"), cacheDir: path.join(root, "c") };
    fs.mkdirSync(isolation.dataDir, { recursive: true });
    const sharedDataDir = path.join(root, "shared");
    fs.mkdirSync(sharedDataDir, { recursive: true });
    expect(() => assertIsolationHeld({ isolation, sharedDataDir, sharedBefore: [] })).toThrow(/no db\//);
  });

  it("ignores a differing snapshot format when the files are the same", () => {
    // Regression: the integration test builds its own "<path>:<size>:<mtime>"
    // snapshot. Comparing whole strings reported a violation for an unchanged
    // file, so only the path part may be compared.
    const root = tempRoot();
    const isolation = fakeIsolation(root);
    const sharedDataDir = path.join(root, "shared");
    fs.mkdirSync(path.join(sharedDataDir, "db"), { recursive: true });
    fs.writeFileSync(path.join(sharedDataDir, "db", "data.sqlite"), "installed");

    const foreignFormat = ["db\\data.sqlite:22:1795717530121.0635"];
    expect(() => assertIsolationHeld({ isolation, sharedDataDir, sharedBefore: foreignFormat })).not.toThrow();
  });

  it("fails when the installed app's data dir gained files", () => {
    const root = tempRoot();
    const isolation = fakeIsolation(root);
    const sharedDataDir = path.join(root, "shared");
    fs.mkdirSync(sharedDataDir, { recursive: true });
    fs.writeFileSync(path.join(sharedDataDir, "jwt-secret"), "installed");
    const sharedBefore = snapshotDir(sharedDataDir);

    // Simulate the gateway writing into the installed app's dir.
    fs.writeFileSync(path.join(sharedDataDir, "jwt-secret"), "installed-and-mutated");
    fs.writeFileSync(path.join(sharedDataDir, "machine-id"), "new");

    expect(() => assertIsolationHeld({ isolation, sharedDataDir, sharedBefore })).toThrow(/Isolation violated/);
  });
});

describe("assertNotInstalledAppPath", () => {
  it("rejects a path inside the installed application", () => {
    const shared = { installDir: path.join("C:", "Apps", "9Router") };
    expect(() => assertNotInstalledAppPath(path.join(shared.installDir, "resources"), shared)).toThrow();
  });

  it("accepts a sibling path", () => {
    const shared = { installDir: path.join("C:", "Apps", "9Router") };
    expect(() => assertNotInstalledAppPath(path.join("C:", "Apps", "9RouterGPUix"), shared)).not.toThrow();
  });
});
