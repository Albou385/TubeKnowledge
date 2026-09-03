import { NextRequest, NextResponse } from "next/server";

import { safePackageError } from "@/lib/chatgpt-packages/http";
import { updatePackageStatus } from "@/lib/chatgpt-packages/runtime";
import { assertSameOrigin } from "@/lib/imports/http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    await updatePackageStatus((await params).id, "downloaded", { event: "package-downloaded" });
    return NextResponse.json({ updated: true });
  } catch (error) { return NextResponse.json({ error: safePackageError(error) }, { status: 400 }); }
}
