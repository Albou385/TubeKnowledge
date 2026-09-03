import { NextResponse } from "next/server";

import { getDiagnosticOverview } from "@/lib/diagnostics/overview";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getDiagnosticOverview(), { status: 200 });
}
