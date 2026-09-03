import { NextRequest, NextResponse } from "next/server";
import { getPortabilityConfig } from "@/lib/portability/config";
import { loadConflicts } from "@/lib/portability/conflicts";
import { portabilityApiError } from "@/lib/portability/http";
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) { try { const { id } = await context.params; const item = (await loadConflicts(getPortabilityConfig())).find((value) => value.conflictId === id); if (!item) return NextResponse.json({ error: { code: "CONFLICTS_BLOCKING", message: "Conflit inconnu." } }, { status: 404 }); return NextResponse.json({ conflict: item }); } catch (error) { return portabilityApiError(error, 404); } }

