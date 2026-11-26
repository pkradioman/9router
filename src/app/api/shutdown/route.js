import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { isExperimentalMode, EXPERIMENTAL_BLOCK_MESSAGE } from "@/lib/experimentalSafety";

export async function POST() {
  if (isExperimentalMode()) {
    return NextResponse.json({ success: false, message: EXPERIMENTAL_BLOCK_MESSAGE }, { status: 403 });
  }

  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ success: false, message: "Not allowed in production" }, { status: 403 });
  }

  const secret = process.env.SHUTDOWN_SECRET;
  const authorization = headers().get("authorization");

  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const response = NextResponse.json({ success: true, message: "Shutting down..." });

  setTimeout(() => {
    process.exit(0);
  }, 500);

  return response;
}

