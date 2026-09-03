import { NextRequest, NextResponse } from "next/server";

import { assertSameOrigin } from "@/lib/imports/http";
import { getAcquisitionManager } from "@/lib/transcription/manager";
import { transcriptionApiError } from "@/lib/transcription/api-errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ jobs: await getAcquisitionManager().list() }, { status: 200 });
  } catch (error) {
    return transcriptionApiError(error, "LIST_FAILED", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const job = await getAcquisitionManager().start(await request.json());
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return transcriptionApiError(error, "ACQUISITION_FAILED", 400);
  }
}
