import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  ImportError,
  isolatedDbPath,
  readImportState,
  runFirstImport,
  validateSnapshotFile,
} from "../src/import-client.mjs";

const TABLES = [
  "_meta",
  "settings",
  "providerConnections",
  "providerNodes",
  "proxyPools",
  "apiKeys",
  "combos",
  "kv",
  "usageHistory",
  "usageDaily",
  "requestDetails",
];

let dir;
let server;
let baseUrl;
let hits;

function buildSnapshotFile({ schemaVersion = 1, backupVersion = 2, skipTable = null } = {}) {
  const file = path.join(dir, `src-${Math.random().toString(16).slice(2)}.sqlite`);
  const db = new DatabaseSync(file);
  try {
    for (const table of TABLES) {
      if (table === skipTable) continue;
      if (table === "_meta") db.exec(`CREATE TABLE "_meta"(key TEXT PRIMARY KEY, value TEXT)`);
      else db.exec(`CREATE TABLE "${table}"(id INTEGER PRIMARY KEY, v TEXT)`);
    }
    // Real shape: `schemaVersion` is the migration number, `backupSchemaVersion`
    // is the app's compatibility constant (2).
    db.exec(`INSERT INTO _meta(key, value) VALUES ('schemaVersion', '${schemaVersion}')`);
    if (backupVersion !== null) {
      db.exec(`INSERT INTO _meta(key, value) VALUES ('backupSchemaVersion', '${backupVersion}')`);
    }
    db.exec(`INSERT INTO settings(id, v) VALUES (1, '{"requireLogin":true}')`);
    db.exec(`INSERT INTO apiKeys(id, v) VALUES (1, 'sk-test')`);
  } finally {
    db.close();
  }
  const bytes = fs.readFileSync(file);
  fs.rmSync(file, { force: true });
  return bytes;
}

async function startSource({ snapshot }) {
  hits = { login: 0, snapshot: 0 };
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      hits.login += 1;
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        let password = null;
        try { password = JSON.parse(body).password; } catch {}
        if (password !== "pw") {
          res.writeHead(401, { "content-type": "application/json" });
          res.end('{"error":"bad"}');
          return;
        }
        res.writeHead(200, { "content-type": "application/json", "set-cookie": "auth_token=jwt-fixture; Path=/; HttpOnly" });
        res.end('{"success":true}');
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/settings/database/snapshot") {
      hits.snapshot += 1;
      const cookie = req.headers.cookie || "";
      if (!cookie.includes("auth_token=jwt-fixture") || req.headers["x-9r-password"] !== "pw") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end('{"error":"Unauthorized"}');
        return;
      }
      res.writeHead(200, {
        "content-type": "application/vnd.sqlite3",
        "content-length": String(snapshot.bytes.length),
        "x-9r-schema-version": "2",
      });
      res.end(snapshot.bytes);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpuix-import-"));
});

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows may still hold the sqlite handle briefly.
  }
});

describe("first-run import", () => {
  it("imports once, then never again", async () => {
    const bytes = buildSnapshotFile();
    await startSource({ snapshot: { bytes } });
    const dataDir = path.join(dir, "data");

    const first = await runFirstImport({ dataDir, password: "pw", baseUrl });
    expect(first.status).toBe("imported");
    expect(fs.existsSync(isolatedDbPath(dataDir))).toBe(true);
    const marker = readImportState(dataDir);
    expect(marker.schemaVersion).toBe(2);
    expect(marker.bytes).toBe(bytes.length);
    expect(marker.sha256).toMatch(/^[0-9a-f]{64}$/);

    const db = new DatabaseSync(isolatedDbPath(dataDir), { readOnly: true });
    try {
      expect(db.prepare("SELECT v FROM apiKeys WHERE id = 1").get().v).toBe("sk-test");
    } finally {
      db.close();
    }

    const second = await runFirstImport({ dataDir, password: "pw", baseUrl });
    expect(second.status).toBe("already-imported");
    expect(hits.login).toBe(1);
    expect(hits.snapshot).toBe(1);
  });

  it("refuses to overwrite an isolated database that already has data", async () => {
    const bytes = buildSnapshotFile();
    await startSource({ snapshot: { bytes } });
    const dataDir = path.join(dir, "data");
    fs.mkdirSync(path.join(dataDir, "db"), { recursive: true });
    const existing = new DatabaseSync(isolatedDbPath(dataDir));
    existing.exec("CREATE TABLE _meta(key TEXT, value TEXT)");
    existing.exec("INSERT INTO _meta VALUES ('schemaVersion','2')");
    existing.close();

    const result = await runFirstImport({ dataDir, password: "pw", baseUrl });
    expect(result.status).toBe("existing-data");
    expect(hits.login).toBe(0);
    expect(hits.snapshot).toBe(0);
    expect(readImportState(dataDir)).toBeNull();
  });

  it("fails closed on a wrong password and leaves nothing behind", async () => {
    await startSource({ snapshot: { bytes: buildSnapshotFile() } });
    const dataDir = path.join(dir, "data");

    await expect(runFirstImport({ dataDir, password: "wrong", baseUrl })).rejects.toBeInstanceOf(ImportError);
    expect(fs.existsSync(isolatedDbPath(dataDir))).toBe(false);
    expect(readImportState(dataDir)).toBeNull();
  });

  it("rejects a corrupt snapshot without promoting it", async () => {
    await startSource({ snapshot: { bytes: Buffer.from("not a database at all") } });
    const dataDir = path.join(dir, "data");

    await expect(runFirstImport({ dataDir, password: "pw", baseUrl })).rejects.toThrow(/not a SQLite database/);
    expect(fs.existsSync(isolatedDbPath(dataDir))).toBe(false);
    expect(readImportState(dataDir)).toBeNull();
  });

  it("rejects a snapshot with a missing table", async () => {
    const bytes = buildSnapshotFile({ skipTable: "requestDetails" });
    await startSource({ snapshot: { bytes } });
    const dataDir = path.join(dir, "data");

    await expect(runFirstImport({ dataDir, password: "pw", baseUrl })).rejects.toThrow(/missing tables/);
    expect(fs.existsSync(isolatedDbPath(dataDir))).toBe(false);
  });

  it("rejects an unsupported schema version", async () => {
    const bytes = buildSnapshotFile({ backupVersion: 3 });
    await startSource({ snapshot: { bytes } });
    const dataDir = path.join(dir, "data");

    await expect(runFirstImport({ dataDir, password: "pw", baseUrl })).rejects.toThrow(/schema version/);
    expect(fs.existsSync(isolatedDbPath(dataDir))).toBe(false);
  });

  it("accepts a database that predates backupSchemaVersion", async () => {
    const bytes = buildSnapshotFile({ backupVersion: null });
    await startSource({ snapshot: { bytes } });
    const dataDir = path.join(dir, "data");

    const result = await runFirstImport({ dataDir, password: "pw", baseUrl });
    expect(result.status).toBe("imported");
    expect(readImportState(dataDir).schemaVersion).toBe(1);
  });
});

describe("validateSnapshotFile", () => {
  it("accepts a well-formed snapshot and reports counts", () => {
    const file = path.join(dir, "ok.sqlite");
    fs.writeFileSync(file, buildSnapshotFile());
    const result = validateSnapshotFile(file);
    expect(result.schemaVersion).toBe(2);
    expect(result.counts.apiKeys).toBe(1);
  });
});
