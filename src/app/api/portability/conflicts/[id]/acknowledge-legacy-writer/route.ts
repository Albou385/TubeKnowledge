import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { assertSameOrigin } from "@/lib/imports/http";
import { PortabilityError } from "@/lib/portability/errors";
import { portabilityApiError } from "@/lib/portability/http";
import { acknowledgeLegacyWriterConflict, legacyWriterConflictAcknowledgementRequestSchema } from "@/lib/portability/legacy-writer-conflict";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (!idempotencyKey || !z.string().uuid().safeParse(idempotencyKey).success) throw new PortabilityError("IDEMPOTENCY_KEY_INVALID");
    const parsedInput = legacyWriterConflictAcknowledgementRequestSchema.safeParse(await request.json());
    if (!parsedInput.success) throw new PortabilityError("CONFLICT_ACTION_NOT_ALLOWED");
    const input = parsedInput.data;
    const { id } = await context.params;
    const result = await acknowledgeLegacyWriterConflict({ conflictId: id, idempotencyKey, ...input });
    return NextResponse.json({ status: result.conflict.status, idempotent: result.idempotent, message: "Le conflit writer historique est classé comme informationnel. Aucune connaissance, autorité ou checkpoint n’a été modifié." });
  } catch (error) {
    return portabilityApiError(error, 409);
  }
}
