import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/imports/http";
import { verifyPortabilityBackup } from "@/lib/portability/backup-reader";
import { getPortabilityConfig } from "@/lib/portability/config";
import { portabilityApiError } from "@/lib/portability/http";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) { try { assertSameOrigin(request); const { id } = await context.params; const { record } = await verifyPortabilityBackup(getPortabilityConfig(), id); return NextResponse.json({ verified: true, backupId: record.backupId, rootHash: record.manifest.sourceRootHash }); } catch (error) { return portabilityApiError(error); } }

