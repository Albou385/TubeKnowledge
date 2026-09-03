import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { searchLibrary } from "@/lib/search/search";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const results = await searchLibrary({
      q: request.nextUrl.searchParams.get("q") ?? "",
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });
    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Requête de recherche invalide." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "La recherche est temporairement indisponible." },
      { status: 503 },
    );
  }
}
