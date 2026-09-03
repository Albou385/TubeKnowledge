import { NextRequest, NextResponse } from "next/server";

import { assertSameOrigin } from "@/lib/imports/http";
import { createLibraryContextPackage } from "@/lib/library-assistant/export";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const zip = await createLibraryContextPackage(await request.json());
    const body = new Blob([new Uint8Array(zip)], { type: "application/zip" });
    return new NextResponse(body, { headers: { "content-type": "application/zip", "content-disposition": "attachment; filename=tubeknowledge-context-codex.zip" } });
  } catch { return NextResponse.json({ error: { code: "EXPORT_FAILED", message: "Le contexte n’a pas pu être préparé." } }, { status: 400 }); }
}
