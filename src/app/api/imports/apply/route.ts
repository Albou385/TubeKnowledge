import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyImport } from "@/lib/imports/apply";
import { assertSameOrigin } from "@/lib/imports/http";
import { ImportSessionError, PUBLIC_IMPORT_SESSION_ERRORS, publicImportSessionError } from "@/lib/imports/sessions";
import { PortabilityError, publicPortabilityError } from "@/lib/portability/errors";

const applySchema = z.object({
  sessionId: z.string().uuid(),
  confirmed: z.literal(true),
  confirmationText: z.string().optional(),
}).strict();

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const input = applySchema.parse(await request.json());
    const result = await applyImport(input);
    return NextResponse.json({ result }, { status: result.status === "success" ? 200 : 409 });
  } catch (error) {
    if (error instanceof ImportSessionError) return NextResponse.json({ error: publicImportSessionError(error) }, { status: PUBLIC_IMPORT_SESSION_ERRORS[error.code].status });
    if (error instanceof PortabilityError) return NextResponse.json({ error: publicPortabilityError(error) }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Application refusée." }, { status: 400 });
  }
}
