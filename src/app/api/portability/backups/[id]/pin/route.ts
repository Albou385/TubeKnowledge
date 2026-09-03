import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/lib/imports/http";
import { getPortabilityConfig } from "@/lib/portability/config";
import { portabilityApiError } from "@/lib/portability/http";
import { setBackupPinned } from "@/lib/portability/retention";
const schema = z.object({ pinned: z.boolean() }).strict();
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) { try { assertSameOrigin(request); const input = schema.parse(await request.json()); const { id } = await context.params; await setBackupPinned(getPortabilityConfig(), id, input.pinned); return NextResponse.json({ backupId: id, pinned: input.pinned }); } catch (error) { return portabilityApiError(error); } }
