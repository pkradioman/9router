import { NextResponse } from "next/server";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { getAdapter } from "@/lib/db/driver.js";
import { getMetaSync } from "@/lib/db/helpers/metaStore.js";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";

// Whole-DB snapshot for the experimental GPUIX desktop import.
//
// Parity with Electron: the copy is produced by the process that owns the DB,
// not by reading the file from outside. sql.js keeps the newest state in memory
// (100 ms debounce), so an external file copy can be stale or partial; every
// adapter's snapshotFile() serializes live state instead.
//
// Auth is the same pair the sibling export route uses (password header or local
// CLI token), and the path is in LOCAL_ONLY_PATHS, so a tunnel/reverse-proxy
// caller cannot pull the whole DB even with a valid JWT.
const CLI_TOKEN_HEADER = "x-9r-cli-token";
const PASSWORD_HEADER = "x-9r-password";
const SNAPSHOT_TIMEOUT_MS = 120_000;

export const dynamic = "force-dynamic";

export async function GET(request) {
  // CLI token requests are already trusted (local machine); skip password re-auth.
  const isCliRequest = Boolean(request.headers.get(CLI_TOKEN_HEADER));
  if (!isCliRequest && !(await verifyDashboardPassword(request.headers.get(PASSWORD_HEADER)))) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  let dir = null;
  try {
    const db = await getAdapter();
    if (typeof db.snapshotFile !== "function") {
      return NextResponse.json(
        { error: "Snapshot not supported by this database driver" },
        { status: 501 }
      );
    }

    // os.tmpdir(), never DATA_DIR: the copy must not sit next to the live DB and
    // must not survive the request.
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "9router-snapshot-"));
    const file = path.join(dir, "data.sqlite");

    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Snapshot timed out")), SNAPSHOT_TIMEOUT_MS);
    });
    try {
      await Promise.race([db.snapshotFile(file), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    const stat = await fsp.stat(file);
    if (!stat.size) throw new Error("Snapshot is empty");

    const schemaVersion =
      getMetaSync(db, "backupSchemaVersion", "") || getMetaSync(db, "schemaVersion", "");
    const stream = fs.createReadStream(file);
    const cleanup = () => {
      if (!dir) return;
      const target = dir;
      dir = null;
      fsp.rm(target, { recursive: true, force: true }).catch(() => {});
    };
    stream.once("close", cleanup);
    stream.once("error", cleanup);

    return new NextResponse(Readable.toWeb(stream), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Length": String(stat.size),
        "Content-Disposition": 'attachment; filename="9router-data.sqlite"',
        "Cache-Control": "no-store",
        "X-9R-Schema-Version": String(schemaVersion ?? ""),
      },
    });
  } catch (error) {
    if (dir) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    // Counts/bytes only — never DB contents or secrets.
    console.log("Error snapshotting database:", error?.message || error);
    return NextResponse.json({ error: "Failed to snapshot database" }, { status: 500 });
  }
}
