import { NextRequest, NextResponse } from "next/server";

import { MockAnalysisProvider } from "@/lib/analysis-providers/mock";
import { analysisInputSchema } from "@/lib/analysis-providers/schema";
import { assertSameOrigin } from "@/lib/imports/http";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const result = await new MockAnalysisProvider().run(analysisInputSchema.parse(await request.json()));
    if (!result.importZip) throw new Error("Résultat mock incomplet.");
    const body = new Blob([new Uint8Array(result.importZip)], { type: "application/zip" });
    return new NextResponse(body, { status: 200, headers: { "content-type": "application/zip", "content-disposition": "attachment; filename=tubeknowledge-mock-analysis.zip", "x-tubeknowledge-fixture": "true" } });
  } catch { return NextResponse.json({ error: { code: "INVALID_PROVIDER_REQUEST", message: "La demande de démonstration est invalide." } }, { status: 400 }); }
}
