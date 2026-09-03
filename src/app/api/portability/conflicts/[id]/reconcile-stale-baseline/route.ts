import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/lib/imports/http";
import { PortabilityError } from "@/lib/portability/errors";
import { portabilityApiError } from "@/lib/portability/http";
import { reconcileStaleBaselineAndReacquireWriter, staleBaselineReconcileRequestSchema } from "@/lib/portability/stale-baseline-expired-writer-reconcile";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (!idempotencyKey || !z.string().uuid().safeParse(idempotencyKey).success) throw new PortabilityError("IDEMPOTENCY_KEY_INVALID");
    const { id } = await context.params;
    const input = staleBaselineReconcileRequestSchema.parse(await request.json());
    const result = await reconcileStaleBaselineAndReacquireWriter({ conflictId: id, idempotencyKey, ...input });
    return NextResponse.json({ status: "resolved", idempotent: false, requiresPhase3Apply: false, message: "La référence locale est réconciliée avec le checkpoint existant et l’autorité locale est réactivée. Aucun fichier Markdown n’a été modifié.", resolvedConflicts: result.resolvedConflictIds.length, next: "/portability" });
  } catch (error) { return portabilityApiError(error); }
}
