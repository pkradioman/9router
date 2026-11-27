import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// The experimental desktop import copies the database from inside the process
// that owns it: sql.js keeps the newest state in memory, so only export() is
// complete. These tests pin that every adapter can produce a valid SQLite file.

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "9router-snap-test-"));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows may still hold a handle; the OS temp cleaner handles it.
  }
}

function expectValidSnapshot(dest, expectedRow = "live-row") {
  const bytes = fs.readFileSync(dest);
  expect(bytes.subarray(0, 16).toString("latin1")).toBe("SQLite format 3\u0000");
  const db = new DatabaseSync(dest, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").all();
    expect(integrity[0].integrity_check).toBe("ok");
    expect(db.prepare("SELECT a FROM t").all().map((r) => r.a)).toEqual([expectedRow]);
  } finally {
    db.close();
  }
}

// better-sqlite3 ships a prebuilt binding per Node ABI; on a host where the
// binding does not load, skip instead of failing the suite.
let createBetterSqliteAdapter = null;
try {
  const mod = await import("../../src/lib/db/adapters/betterSqliteAdapter.js");
  const probe = mod.createBetterSqliteAdapter(":memory:");
  probe.close();
  createBetterSqliteAdapter = mod.createBetterSqliteAdapter;
} catch {
  createBetterSqliteAdapter = null;
}

describe("adapter snapshotFile", () => {
  it("node:sqlite writes a valid, readable copy", async () => {
    const dir = tempDir();
    const src = path.join(dir, "src.sqlite");
    const dest = path.join(dir, "out.sqlite");
    try {
      const { createNodeSqliteAdapter } = await import("../../src/lib/db/adapters/nodeSqliteAdapter.js");
      const db = await createNodeSqliteAdapter(src);
      db.exec("CREATE TABLE t(a TEXT)");
      db.run("INSERT INTO t(a) VALUES (?)", ["live-row"]);
      await db.snapshotFile(dest);
      db.close();
      expectValidSnapshot(dest);
    } finally {
      cleanup(dir);
    }
  });

  it("sql.js exports in-memory state before the debounce flush", async () => {
    const dir = tempDir();
    const src = path.join(dir, "src.sqlite");
    const dest = path.join(dir, "out.sqlite");
    try {
      const { createSqlJsAdapter } = await import("../../src/lib/db/adapters/sqljsAdapter.js");
      const db = await createSqlJsAdapter(src);
      db.exec("CREATE TABLE t(a TEXT)");
      // No await for the 100 ms debounce: the snapshot must still see the row.
      db.run("INSERT INTO t(a) VALUES (?)", ["live-row"]);
      await db.snapshotFile(dest);
      db.close();
      expectValidSnapshot(dest);
    } finally {
      cleanup(dir);
    }
  });

  it.skipIf(!createBetterSqliteAdapter)("better-sqlite3 writes a valid copy", async () => {
    const dir = tempDir();
    const src = path.join(dir, "src.sqlite");
    const dest = path.join(dir, "out.sqlite");
    try {
      const db = createBetterSqliteAdapter(src);
      db.exec("CREATE TABLE t(a TEXT)");
      db.run("INSERT INTO t(a) VALUES (?)", ["live-row"]);
      await db.snapshotFile(dest);
      db.close();
      expectValidSnapshot(dest);
    } finally {
      cleanup(dir);
    }
  });
});
