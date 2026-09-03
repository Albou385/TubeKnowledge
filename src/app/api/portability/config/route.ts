import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/lib/imports/http";
import { getPortabilityConfig } from "@/lib/portability/config";
import { ensureMachineIdentity, loadMachineIdentity, updateMachineIdentity } from "@/lib/portability/machine-identity";
import { portabilityApiError } from "@/lib/portability/http";
const schema = z.object({ displayName: z.string().trim().min(1).max(80), rolePreference: z.enum(["reader", "writer"]) }).strict();
export async function POST(request: NextRequest) { try { assertSameOrigin(request); const input = schema.parse(await request.json()); const config = getPortabilityConfig(); if (!config.enabled) throw new Error("Portabilité non activée dans .env.local."); const identity = await loadMachineIdentity(config) ? await updateMachineIdentity(config, input) : await ensureMachineIdentity(config, input); return NextResponse.json({ machine: identity }); } catch (error) { return portabilityApiError(error); } }

