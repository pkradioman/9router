import { NextResponse } from "next/server";
import { killAppProcesses, spawnUpdaterAndExit } from "@/lib/appUpdater";
import { isExperimentalMode, EXPERIMENTAL_BLOCK_MESSAGE } from "@/lib/experimentalSafety";

export async function POST() {
  // Experimental desktop: this route kills every 9router process on the machine
  // (including the installed app, its tray and MITM) and rewrites the global npm
  // package. Refuse explicitly so a direct invocation cannot bypass middleware.
  if (isExperimentalMode()) {
    return NextResponse.json({ success: false, message: EXPERIMENTAL_BLOCK_MESSAGE }, { status: 403 });
  }

  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json(
      { success: false, message: "Update is only available in production build (9router CLI)" },
      { status: 403 }
    );
  }

  try {
    // Kill sibling processes (cloudflared, MITM, stray next-server) to release file locks on Windows
    await killAppProcesses();
  } catch { /* best effort */ }

  // Schedule detached updater then exit current server process
  spawnUpdaterAndExit();

  return NextResponse.json({ success: true, message: "Updater started. This app will exit shortly." });
}
