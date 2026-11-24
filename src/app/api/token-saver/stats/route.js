import { NextResponse } from "next/server";
import { getTokenSaverStats } from "@/lib/db/repos/tokenSaverRepo.js";
import { SAVER_PERIODS } from "@/lib/tokenSaver/stats.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";
    if (!(period in SAVER_PERIODS)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }
    return NextResponse.json(await getTokenSaverStats(period));
  } catch (error) {
    console.error("[API] Failed to get token saver stats:", error);
    return NextResponse.json({ error: "Failed to fetch token saver stats" }, { status: 500 });
  }
}
