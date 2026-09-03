import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/lib/imports/http";
import { getPortabilityConfig } from "@/lib/portability/config";
import { portabilityApiError } from "@/lib/portability/http";
import { applyRestore } from "@/lib/portability/restore-apply";
const schema = z.object({ restoreId: z.string().uuid(), confirmed: z.literal(true), confirmationText: z.string().optional() }).strict();
export async function POST(request: NextRequest) { try { assertSameOrigin(request); const input = schema.parse(await request.json()); const result = await applyRestore(getPortabilityConfig(), process.env, input); return NextResponse.json({ result }, { status: result.status === "success" ? 200 : 409 }); } catch (error) { return portabilityApiError(error, 409); } }
