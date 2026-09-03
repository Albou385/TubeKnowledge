import { NextResponse } from "next/server";

import { resumeImportPreview } from "@/lib/imports/preview";
import { ImportSessionError, PUBLIC_IMPORT_SESSION_ERRORS, publicImportSessionError } from "@/lib/imports/sessions";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json({ preview: await resumeImportPreview((await params).id) });
  } catch (error) {
    if (error instanceof ImportSessionError) return NextResponse.json({ error: publicImportSessionError(error) }, { status: PUBLIC_IMPORT_SESSION_ERRORS[error.code].status });
    return NextResponse.json({ error: { code: "SESSION_INVALID", message: "Cette vérification locale est invalide.", action: "Prévalidez de nouveau le ZIP retourné." } }, { status: 409 });
  }
}
