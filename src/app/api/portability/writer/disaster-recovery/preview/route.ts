import { NextRequest, NextResponse } from "next/server";

import { assertSameOrigin } from "@/lib/imports/http";
import { portabilityApiError } from "@/lib/portability/http";
import { previewWriterDisasterRecovery, writerDisasterRecoveryPreviewRequestSchema } from "@/lib/portability/writer-disaster-recovery";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const input = writerDisasterRecoveryPreviewRequestSchema.parse(await request.json());
    return NextResponse.json({ preview: await previewWriterDisasterRecovery(input) });
  } catch (error) {
    return portabilityApiError(error, 409);
  }
}
