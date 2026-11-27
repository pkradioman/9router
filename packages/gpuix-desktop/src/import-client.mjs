// First-run import from the installed application's database.
//
// The source is the production app's own snapshot endpoint (added in the same
// series of changes): it serializes live state inside the process that owns the
// DB, so the sql.js debounce cannot hand us a stale or partial file. We never
// read the installed app's data directory ourselves.
//
// Contract:
//   - runs at most once per experimental data dir (`import-state.json` marker)
//   - refuses to overwrite an isolated DB that already has data
//   - validates before swapping in the file; any failure leaves no DB and no
//     marker, so the next launch can retry cleanly
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DEFAULT_SOURCE_URL = "http://127.0.0.1:20128";
export const IMPORT_MARKER = "import-state.json";
export const EXPECTED_SCHEMA_VERSION = 2;
export const REQUIRED_TABLES = [
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

const SQLITE_MAGIC = "SQLite format 3\u0000";
const SNAPSHOT_TIMEOUT_MS = 120_000;
const LOGIN_TIMEOUT_MS = 15_000;

export class ImportError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = "ImportError";
    this.detail = detail;
  }
}

export function isolatedDbPath(dataDir) {
  return path.join(dataDir, "db", "data.sqlite");
}

export function importMarkerPath(dataDir) {
  return path.join(dataDir, IMPORT_MARKER);
}

export function readImportState(dataDir) {
  try {
    const raw = fs.readFileSync(importMarkerPath(dataDir), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// True only when the isolated DB exists and carries at least one `_meta` row.
// An empty or absent DB is a first run; an unreadable one is an error, because
// guessing could overwrite user data.
export function isolatedDbHasData(dbPath) {
  if (!fs.existsSync(dbPath)) return false;
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare("SELECT COUNT(*) AS c FROM _meta").get();
    return Number(row?.c ?? 0) > 0;
  } catch (error) {
    throw new ImportError(`Existing isolated database is unreadable: ${error?.message || error}`, { dbPath });
  } finally {
    try { db?.close(); } catch {}
  }
}

export async function loginToSource({ baseUrl, password, fetchImpl = fetch }) {
  const res = await fetchImpl(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new ImportError(`Sign-in to the installed app failed (status ${res.status}).`, { status: res.status });
  }
  const raw = res.headers.get("set-cookie") || "";
  const match = raw.match(/auth_token=([^;]+)/);
  if (!match) throw new ImportError("Sign-in succeeded but no auth cookie was returned.");
  return `auth_token=${match[1]}`;
}

export async function downloadSnapshot({ baseUrl, cookie, password, fetchImpl = fetch }) {
  const res = await fetchImpl(`${baseUrl}/api/settings/database/snapshot`, {
    method: "GET",
    headers: {
      cookie,
      // Same pair the dashboard export uses: the session proves the guard, the
      // password header is the route's own re-auth.
      "x-9r-password": password,
    },
    signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new ImportError(`Snapshot request failed (status ${res.status}).`, { status: res.status });
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length) throw new ImportError("Snapshot response was empty.");
  return bytes;
}

// Read-only validation of a downloaded file. A file that fails here is never
// promoted to the isolated DB.
export function validateSnapshotFile(filePath) {
  const fd = fs.openSync(filePath, "r");
  let header;
  try {
    header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (header.toString("latin1") !== SQLITE_MAGIC) {
    throw new ImportError("Snapshot is not a SQLite database (bad header).");
  }

  let db;
  try {
    db = new DatabaseSync(filePath, { readOnly: true });
    const integrity = db.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
      throw new ImportError("Snapshot failed PRAGMA integrity_check.");
    }
    const tables = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
    );
    const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
    if (missing.length) {
      throw new ImportError(`Snapshot is missing tables: ${missing.join(", ")}.`, { missing });
    }
    // `_meta.schemaVersion` is the migration number (1 today), while the app's
    // compatibility constant SCHEMA_VERSION (2) is stored as
    // `backupSchemaVersion`. Prefer the compatibility stamp; a DB written before
    // that key existed is still accepted because the gateway runs additive
    // migrations on open — what matters is that the schema family is readable.
    const metaRow = (key) => db.prepare("SELECT value FROM _meta WHERE key = ?").get(key)?.value ?? null;
    const migrationVersion = Number(metaRow("schemaVersion"));
    const backupVersionRaw = metaRow("backupSchemaVersion");
    const backupVersion = backupVersionRaw === null ? null : Number(backupVersionRaw);
    if (backupVersion !== null) {
      if (backupVersion !== EXPECTED_SCHEMA_VERSION) {
        throw new ImportError(
          `Snapshot schema version ${backupVersionRaw} does not match the supported version ${EXPECTED_SCHEMA_VERSION}.`,
          { schemaVersion: backupVersionRaw }
        );
      }
    } else if (!Number.isFinite(migrationVersion) || migrationVersion < 1) {
      throw new ImportError("Snapshot has no usable schema version in _meta.");
    }
    const schemaVersion = backupVersion ?? migrationVersion;
    const counts = {};
    for (const table of REQUIRED_TABLES) {
      counts[table] = Number(db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get()?.c ?? 0);
    }
    return { schemaVersion, counts };
  } finally {
    try { db?.close(); } catch {}
  }
}

// Download beside the target, validate it there, then rename into place. The
// rename stays on one volume; a leftover target from a failed launch is removed
// first (the gateway has not started yet, so nothing holds it).
function writeMarker(dataDir, marker) {
  const file = importMarkerPath(dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * Import the installed app's database once, before the gateway starts.
 *
 * @returns {{status: "already-imported"|"existing-data"|"imported", detail?: object}}
 */
export async function runFirstImport({
  dataDir,
  password,
  baseUrl = DEFAULT_SOURCE_URL,
  fetchImpl = fetch,
  log = () => {},
}) {
  if (readImportState(dataDir)) {
    log("import skipped: already imported once");
    return { status: "already-imported" };
  }

  const dbPath = isolatedDbPath(dataDir);
  if (isolatedDbHasData(dbPath)) {
    log("import skipped: isolated database already has data");
    return { status: "existing-data" };
  }

  if (!password) throw new ImportError("Import needs the dashboard password of the installed app.");

  const cookie = await loginToSource({ baseUrl, password, fetchImpl });
  const bytes = await downloadSnapshot({ baseUrl, cookie, password, fetchImpl });

  const dir = path.dirname(dbPath);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.data.sqlite.${crypto.randomBytes(6).toString("hex")}.download`);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  try {
    const handle = await fsp.open(tmp, "w");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const { schemaVersion, counts } = validateSnapshotFile(tmp);
    if (fs.existsSync(dbPath)) await fsp.rm(dbPath, { force: true });
    await fsp.rename(tmp, dbPath);
    writeMarker(dataDir, {
      source: baseUrl,
      importedAt: new Date().toISOString(),
      bytes: bytes.length,
      sha256,
      schemaVersion,
    });
    log(
      "import complete",
      `bytes=${bytes.length} sha256=${sha256.slice(0, 12)}… tables=${Object.keys(counts).length}`
    );
    return { status: "imported", detail: { bytes: bytes.length, sha256, schemaVersion } };
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {});
  }
}
