import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/lib/imports/http";
import { getPortabilityConfig } from "@/lib/portability/config";
import { previewConflictResolution } from "@/lib/portability/conflicts";
import { resolveCurrentConflict } from "@/lib/portability/conflict-resolution";
import { expiredLocalConflictReacquireRequestSchema, keepCurrentAndReacquireExpiredLocalWriter } from "@/lib/portability/expired-local-conflict-reacquire";
import { PortabilityError } from "@/lib/portability/errors";
import { portabilityApiError } from "@/lib/portability/http";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["keep-current", "false-positive"]), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("keep-current-and-reacquire"), backupId: z.string().uuid(), confirmationText: z.string() }).strict(),
  z.object({ action: z.enum(["replace-alternative", "manual-merge", "archive-copy"]), targetPath: z.string().min(1), content: z.string().max(1024 * 1024) }).strict(),
]);

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const input = schema.parse(await request.json());
    const { id } = await context.params;
    const config = getPortabilityConfig();
    if (input.action === "keep-current-and-reacquire") {
      const idempotencyKey = request.headers.get("Idempotency-Key");
      if (!idempotencyKey || !z.string().uuid().safeParse(idempotencyKey).success) throw new PortabilityError("IDEMPOTENCY_KEY_INVALID");
      const requestInput = expiredLocalConflictReacquireRequestSchema.parse({ backupId: input.backupId, confirmationText: input.confirmationText });
      const result = await keepCurrentAndReacquireExpiredLocalWriter({ conflictId: id, idempotencyKey, ...requestInput });
      return NextResponse.json({ status: result.conflict.status, idempotent: false, requiresPhase3Apply: false, message: "Le contenu actuel devient la nouvelle référence et l’autorité locale est réactivée. Le fichier n’a pas été modifié.", next: "/portability" });
    }
    if (input.action === "false-positive" || input.action === "keep-current") {
      const result = await resolveCurrentConflict(id, input.action === "keep-current" ? "resolved" : "false-positive");
      return NextResponse.json({ status: result.conflict.status, idempotent: result.idempotent, requiresPhase3Apply: false, message: input.action === "keep-current" ? "Le contenu actuel a été conservé explicitement." : "Le conflit a été classé comme faux positif.", next: "/portability" });
    }
    if (!("targetPath" in input)) throw new Error("Action de résolution invalide.");
    const preview = await previewConflictResolution({ conflictId: id, targetPath: input.targetPath, content: input.content }, config, process.env);
    return NextResponse.json({ preview, requiresPhase3Apply: true });
  } catch (error) { return portabilityApiError(error); }
}
