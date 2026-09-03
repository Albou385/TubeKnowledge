import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { assertSameOrigin } from "@/lib/imports/http";
import { PortabilityError } from "@/lib/portability/errors";
import { portabilityApiError } from "@/lib/portability/http";
import { reacquireWriter } from "@/lib/portability/writer-operations";

const schema = z.object({
  backupId: z.string().uuid(),
  confirmationText: z.literal("REACQUERIR"),
}).strict();

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (!idempotencyKey || !z.string().uuid().safeParse(idempotencyKey).success) throw new PortabilityError("IDEMPOTENCY_KEY_INVALID");
    const input = schema.parse(await request.json());
    const result = await reacquireWriter({ ...input, idempotencyKey });
    return NextResponse.json(result);
  } catch (error) {
    return portabilityApiError(error, 409);
  }
}
