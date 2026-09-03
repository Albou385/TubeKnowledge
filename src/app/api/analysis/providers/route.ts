import { NextResponse } from "next/server";

import { defaultAnalysisProvider, listAnalysisProviderAvailability } from "@/lib/analysis-providers/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ defaultProvider: defaultAnalysisProvider(), providers: listAnalysisProviderAvailability() });
}
