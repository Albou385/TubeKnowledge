import { NextRequest, NextResponse } from "next/server";

import { assertSameOrigin } from "@/lib/imports/http";
import { getAcquisitionManager } from "@/lib/transcription/manager";
import { transcriptionApiError } from "@/lib/transcription/api-errors";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    return NextResponse.json({ job: await getAcquisitionManager().cancel(id) }, { status: 200 });
  } catch (error) {
    return transcriptionApiError(error, "CANCEL_FAILED", 400);
  }
}
