// Bun runtime adapter — uses built-in bun:sqlite (native, fastest under Bun).
// Loaded only when process.versions.bun is present.
import fs from "node:fs";
import { PRAGMA_SQL } from "../schema.js";

const CHECKPOINT_INTERVAL_MS = 60 * 1000;

export async function createBunSqliteAdapter(filePath) {
  // Dynamic import — only resolves under Bun runtime
  const { Database } = await import("bun:sqlite");
  const db = new Database(filePath, { create: true });
  db.exec(PRAGMA_SQL);

  const stmtCache = new Map();
  function prepare(sql) {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  const checkpointTimer = setInterval(() => {
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}
  }, CHECKPOINT_INTERVAL_MS);
  if (typeof checkpointTimer.unref === "function") checkpointTimer.unref();

  function gracefulClose() {
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}
    try { stmtCache.clear(); } catch {}
    try { db.close(); } catch {}
  }
  const onShutdown = () => gracefulClose();
  process.once("beforeExit", onShutdown);
  process.once("SIGINT", () => { onShutdown(); process.exit(0); });
  process.once("SIGTERM", () => { onShutdown(); process.exit(0); });

  return {
    driver: "bun:sqlite",
    run(sql, params = []) {
      const r = prepare(sql).run(...params);
      return { changes: Number(r.changes ?? 0), lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
    },
    get(sql, params = []) {
      return prepare(sql).get(...params);
    },
    all(sql, params = []) {
      return prepare(sql).all(...params);
    },
    exec(sql) { return db.exec(sql); },
    transaction(fn) {
      // bun:sqlite has db.transaction() API (similar to better-sqlite3)
      const tx = db.transaction(fn);
      return tx();
    },
    checkpoint() { try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {} },
    // Consistent live copy for the experimental desktop import. bun:sqlite has
    // no file backup API; serialize() returns a complete Buffer of the database.
    async snapshotFile(destPath) {
      const data = db.serialize();
      fs.writeFileSync(destPath, Buffer.isBuffer(data) ? data : Buffer.from(data));
      return destPath;
    },
    close() {
      clearInterval(checkpointTimer);
      gracefulClose();
    },
    raw: db,
  };
}
