import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";

import { safePackageError } from "@/lib/chatgpt-packages/http";
import { packageZipPath } from "@/lib/chatgpt-packages/runtime";

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = (await params).id;
    const bytes = await readFile(await packageZipPath(id));
    return new NextResponse(bytes, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="tubeknowledge-analysis-request-${id}.zip"`, "cache-control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: safePackageError(error, "Téléchargement impossible.") }, { status: 404 }); }
}
