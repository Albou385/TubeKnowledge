import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { assertSameOrigin } from "@/lib/imports/http";
import { PortabilityError } from "@/lib/portability/errors";
import { portabilityApiError } from "@/lib/portability/http";
import { renewWriter } from "@/lib/portability/writer-operations";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (!idempotencyKey || !z.string().uuid().safeParse(idempotencyKey).success) throw new PortabilityError("IDEMPOTENCY_KEY_INVALID");
    const result = await renewWriter(idempotencyKey);
    return NextResponse.json(result);
  } catch (error) {
    return portabilityApiError(error, 409);
  }
}
