import { NextRequest, NextResponse } from "next/server";

import { safePackageError } from "@/lib/chatgpt-packages/http";
import { readPackageHistory } from "@/lib/chatgpt-packages/runtime";

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json({ history: await readPackageHistory((await params).id) }); }
  catch (error) { return NextResponse.json({ error: safePackageError(error) }, { status: 404 }); }
}
