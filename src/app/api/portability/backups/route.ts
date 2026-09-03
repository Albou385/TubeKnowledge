import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { assertSameOrigin } from "@/lib/imports/http";
import { createPortabilityBackup } from "@/lib/portability/backup-builder";
import { listBackupRecords } from "@/lib/portability/backup-reader";
import { getPortabilityConfig } from "@/lib/portability/config";
import { portabilityApiError } from "@/lib/portability/http";
import { loadMachineIdentity } from "@/lib/portability/machine-identity";
import { createStableSnapshot } from "@/lib/portability/snapshots";
const schema = z.object({ profile: z.enum(["knowledge", "full", "before-write"]).default("knowledge") }).strict();
export async function GET() { try { const config = getPortabilityConfig(); const records = await listBackupRecords(config); return NextResponse.json({ backups: records.map((item) => ({ backupId: item.backupId, createdAt: item.manifest.createdAt, profile: item.manifest.profile, fileCount: item.manifest.fileCount, zipBytes: item.zipBytes, rootHash: item.manifest.sourceRootHash.slice(0, 12), verified: item.verified, pinned: item.pinned })) }); } catch (error) { return portabilityApiError(error); } }
export async function POST(request: NextRequest) { try { assertSameOrigin(request); const input = schema.parse(await request.json()); const config = getPortabilityConfig(); const library = parseLibraryConfig(); const identity = await loadMachineIdentity(config); if (!library.ok || !identity) throw new Error("Configuration incomplète."); await createStableSnapshot(library.rootPath, identity.machineId, config.stabilityWindowSeconds); const record = await createPortabilityBackup(library.rootPath, config, identity, input.profile); return NextResponse.json({ backup: { backupId: record.backupId, verified: record.verified, zipSha256: record.zipSha256, zipBytes: record.zipBytes } }, { status: 201 }); } catch (error) { return portabilityApiError(error); } }

