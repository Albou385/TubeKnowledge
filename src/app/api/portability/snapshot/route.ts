import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { assertSameOrigin } from "@/lib/imports/http";
import { getPortabilityConfig } from "@/lib/portability/config";
import { appendPortabilityHistory } from "@/lib/portability/history";
import { portabilityApiError } from "@/lib/portability/http";
import { loadMachineIdentity } from "@/lib/portability/machine-identity";
import { createStableSnapshot, persistLatestSnapshot, readLatestSnapshot } from "@/lib/portability/snapshots";
import { latestCheckpoint } from "@/lib/portability/checkpoints";
import { detectConflicts, isBlockingKnowledgeConflict } from "@/lib/portability/conflicts";
import { readWriterAuthority } from "@/lib/portability/writer-authority";
export async function POST(request: NextRequest) { try { assertSameOrigin(request); const config = getPortabilityConfig(); const library = parseLibraryConfig(); const identity = await loadMachineIdentity(config); if (!library.ok || !identity) throw new Error("Configuration incomplète."); const baseSnapshot = await readLatestSnapshot(config); const snapshot = await createStableSnapshot(library.rootPath, identity.machineId, config.stabilityWindowSeconds); const conflicts = await detectConflicts(snapshot, config, await latestCheckpoint(library.rootPath), { baseSnapshot: baseSnapshot || undefined, writerAuthority: await readWriterAuthority(library.rootPath) }); if (!conflicts.some(isBlockingKnowledgeConflict)) await persistLatestSnapshot(config, snapshot); await appendPortabilityHistory(config.statePath, { schemaVersion: 1, eventId: randomUUID(), event: "snapshot-created", timestamp: snapshot.createdAt, machineId: identity.machineId, relatedId: snapshot.snapshotId }); return NextResponse.json({ snapshot: { ...snapshot, files: snapshot.files.map((file) => ({ ...file, sha256: file.sha256.slice(0, 12) })) }, conflicts }); } catch (error) { return portabilityApiError(error); } }
