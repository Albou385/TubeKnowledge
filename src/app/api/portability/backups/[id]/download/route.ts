import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { loadBackupRecord } from "@/lib/portability/backup-reader";
import { getPortabilityConfig } from "@/lib/portability/config";
import { portabilityApiError } from "@/lib/portability/http";
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) { try { const { id } = await context.params; const record = await loadBackupRecord(getPortabilityConfig(), id); return new NextResponse(await readFile(record.zipPath), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="tubeknowledge-backup-${record.backupId}.zip"`, "Cache-Control": "no-store" } }); } catch (error) { return portabilityApiError(error, 404); } }

