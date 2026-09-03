import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { assertSameOrigin } from "@/lib/imports/http";
import { bootstrapWriter } from "@/lib/portability/bootstrap-writer";
import { PortabilityError } from "@/lib/portability/errors";
import { portabilityApiError } from "@/lib/portability/http";

const schema = z.object({
  backupId: z.string().uuid(),
  confirmationText: z.literal("REPRENDRE"),
}).strict();

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (!idempotencyKey || !z.string().uuid().safeParse(idempotencyKey).success) {
      throw new PortabilityError("IDEMPOTENCY_KEY_INVALID");
    }
    const input = schema.parse(await request.json());
    const result = await bootstrapWriter({ ...input, idempotencyKey });
    return NextResponse.json(result);
  } catch (error) {
    return portabilityApiError(error, 409);
  }
}
