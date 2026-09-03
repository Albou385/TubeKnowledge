import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { assertSameOrigin } from "@/lib/imports/http";
import { loadBackupRecord } from "@/lib/portability/backup-reader";
import { latestCheckpoint } from "@/lib/portability/checkpoints";
import { getPortabilityConfig } from "@/lib/portability/config";
import { prepareHandoff } from "@/lib/portability/handoff";
import { portabilityApiError } from "@/lib/portability/http";
import { loadMachineIdentity } from "@/lib/portability/machine-identity";
import { createStableSnapshot } from "@/lib/portability/snapshots";
import { loadOperationSettings } from "@/lib/portability/operation-settings";
import { PortabilityError } from "@/lib/portability/errors";
const schema = z.object({ backupId: z.string().uuid() }).strict();
export async function POST(request: NextRequest) { try { assertSameOrigin(request); const input = schema.parse(await request.json()); const config = getPortabilityConfig(); if ((await loadOperationSettings(config)).singleMachineMode) throw new PortabilityError("SINGLE_MACHINE_MODE_HANDOFF_BLOCKED"); const library = parseLibraryConfig(); const identity = await loadMachineIdentity(config); if (!library.ok || !identity) throw new Error("Configuration incomplète."); const [checkpoint, backup, snapshot] = await Promise.all([latestCheckpoint(library.rootPath), loadBackupRecord(config, input.backupId), createStableSnapshot(library.rootPath, identity.machineId, config.stabilityWindowSeconds)]); if (!checkpoint) throw new Error("Checkpoint absent."); const handoff = await prepareHandoff(library.rootPath, identity, snapshot, checkpoint, backup); return NextResponse.json({ handoff, manualStep: "Attendez la fin visible de OneDrive avant l’acceptation sur l’autre machine. TubeKnowledge ne certifie pas le cloud." }, { status: 201 }); } catch (error) { return portabilityApiError(error, 409); } }

