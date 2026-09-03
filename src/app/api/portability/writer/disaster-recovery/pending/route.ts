import { NextResponse } from "next/server";

import { portabilityApiError } from "@/lib/portability/http";
import { discoverPendingWriterDisasterRecovery } from "@/lib/portability/writer-disaster-recovery";

export async function GET() {
  try {
    return NextResponse.json({ pending: await discoverPendingWriterDisasterRecovery() });
  } catch (error) {
    return portabilityApiError(error, 409);
  }
}
