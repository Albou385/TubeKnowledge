import { NextRequest, NextResponse } from "next/server";

import { assertSameOrigin } from "@/lib/imports/http";
import { portabilityApiError } from "@/lib/portability/http";
import { resumePendingWriterDisasterRecovery, writerDisasterRecoveryResumeRequestSchema } from "@/lib/portability/writer-disaster-recovery";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const input = writerDisasterRecoveryResumeRequestSchema.parse(await request.json());
    return NextResponse.json({ result: await resumePendingWriterDisasterRecovery(input) });
  } catch (error) {
    return portabilityApiError(error, 409);
  }
}
