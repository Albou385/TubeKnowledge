import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { safePackageError } from "@/lib/chatgpt-packages/http";
import { deleteStoredPackage, loadStoredPackage } from "@/lib/chatgpt-packages/runtime";
import { assertSameOrigin } from "@/lib/imports/http";

const deleteSchema = z.object({ confirmed: z.literal(true) }).strict();
export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json({ package: await loadStoredPackage((await params).id) }); }
  catch (error) { return NextResponse.json({ error: safePackageError(error, "Paquet introuvable.") }, { status: 404 }); }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    deleteSchema.parse(await request.json());
    await deleteStoredPackage((await params).id, true);
    return NextResponse.json({ deleted: true });
  } catch (error) { return NextResponse.json({ error: safePackageError(error) }, { status: 400 }); }
}
