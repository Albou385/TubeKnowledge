import { NextResponse } from "next/server";
import { getPortabilityConfig } from "@/lib/portability/config";
import { loadConflicts } from "@/lib/portability/conflicts";
import { portabilityApiError } from "@/lib/portability/http";
export async function GET() { try { const values = await loadConflicts(getPortabilityConfig()); return NextResponse.json({ conflicts: values.map((item) => ({ ...item, evidence: { ...item.evidence, hashes: item.evidence.hashes?.map((hash) => hash.slice(0, 12)) } })) }); } catch (error) { return portabilityApiError(error); } }

