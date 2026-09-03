import { NextRequest, NextResponse } from "next/server";

import { assertSameOrigin } from "@/lib/imports/http";
import { getAcquisitionManager } from "@/lib/transcription/manager";
import { inspectRequestSchema } from "@/lib/transcription/schemas";
import { transcriptionApiError } from "@/lib/transcription/api-errors";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const input = inspectRequestSchema.parse(await request.json());
    const job = await getAcquisitionManager().inspect(input.url);
    return NextResponse.json({ job }, { status: 200 });
  } catch (error) {
    return transcriptionApiError(error, "INSPECTION_FAILED", 400);
  }
}
