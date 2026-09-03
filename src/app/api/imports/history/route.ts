import { NextResponse } from "next/server";

import { parseLibraryConfig } from "@/lib/config/library-config";
import { readImportHistory } from "@/lib/imports/history";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = parseLibraryConfig();
  if (!config.ok) return NextResponse.json({ error: "Bibliothèque non configurée." }, { status: 503 });
  try { return NextResponse.json({ history: await readImportHistory(config.rootPath) }); }
  catch { return NextResponse.json({ error: "Historique temporairement indisponible." }, { status: 503 }); }
}
