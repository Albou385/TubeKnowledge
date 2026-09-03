import { NextResponse } from "next/server";
import { getPortabilityStatus } from "@/lib/portability/status";
import { portabilityApiError } from "@/lib/portability/http";
export const dynamic = "force-dynamic";
export async function GET() { try { return NextResponse.json({ status: await getPortabilityStatus() }); } catch (error) { return portabilityApiError(error); } }

