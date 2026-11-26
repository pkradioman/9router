import { NextResponse } from "next/server";
import { killAppProcesses } from "@/lib/appUpdater";
import { isExperimentalMode, EXPERIMENTAL_BLOCK_MESSAGE } from "@/lib/experimentalSafety";

// Shutdown app to release file locks for manual update
export async function POST() {
  if (isExperimentalMode()) {
    return NextResponse.json({ success: false, message: EXPERIMENTAL_BLOCK_MESSAGE }, { status: 403 });
  }

  try {
    await killAppProcesses();
  } catch { /* best effort */ }

  const response = NextResponse.json({ success: true, message: "Shutting down for manual update..." });

  setTimeout(() => process.exit(0), 500);

  return response;
}
