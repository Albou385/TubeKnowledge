import { NextRequest, NextResponse } from "next/server";

import { listEligibleContextFiles, suggestContextFiles } from "@/lib/chatgpt-packages/context";
import { safePackageError } from "@/lib/chatgpt-packages/http";
import { suggestionRequestSchema } from "@/lib/chatgpt-packages/schema";
import { assertSameOrigin } from "@/lib/imports/http";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const input = suggestionRequestSchema.parse(await request.json());
    const [suggestions, availableFiles] = await Promise.all([suggestContextFiles(input.acquisitionId, input.limit), listEligibleContextFiles()]);
    return NextResponse.json({ suggestions, availableFiles });
  } catch (error) { return NextResponse.json({ error: safePackageError(error) }, { status: 400 }); }
}
