import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/imports/http";
import { loadBackupRecord } from "@/lib/portability/backup-reader";
import { getPortabilityConfig } from "@/lib/portability/config";
import { portabilityApiError } from "@/lib/portability/http";
import { deleteBackupExplicitly } from "@/lib/portability/retention";
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) { try { const { id } = await context.params; const record = await loadBackupRecord(getPortabilityConfig(), id); return NextResponse.json({ backup: { backupId: record.backupId, createdAt: record.manifest.createdAt, profile: record.manifest.profile, fileCount: record.manifest.fileCount, totalBytes: record.manifest.totalBytes, zipBytes: record.zipBytes, rootHash: record.manifest.sourceRootHash, zipSha256: record.zipSha256, verified: record.verified, pinned: record.pinned, files: record.manifest.files } }); } catch (error) { return portabilityApiError(error, 404); } }
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) { try { assertSameOrigin(request); const { confirmed } = await request.json() as { confirmed?: boolean }; const { id } = await context.params; await deleteBackupExplicitly(getPortabilityConfig(), id, confirmed === true); return NextResponse.json({ deleted: true }); } catch (error) { return portabilityApiError(error); } }

