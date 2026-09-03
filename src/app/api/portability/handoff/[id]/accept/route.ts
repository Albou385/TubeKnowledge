import { NextRequest, NextResponse } from "next/server";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { assertSameOrigin } from "@/lib/imports/http";
import { getPortabilityConfig } from "@/lib/portability/config";
import { isBlockingKnowledgeConflict, loadConflicts } from "@/lib/portability/conflicts";
import { acceptHandoff } from "@/lib/portability/handoff";
import { portabilityApiError } from "@/lib/portability/http";
import { loadMachineIdentity } from "@/lib/portability/machine-identity";
import { createStableSnapshot } from "@/lib/portability/snapshots";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) { try { assertSameOrigin(request); const { id } = await context.params; const config = getPortabilityConfig(); const library = parseLibraryConfig(); const identity = await loadMachineIdentity(config); if (!library.ok || !identity) throw new Error("Configuration incomplète."); const [snapshot, conflicts] = await Promise.all([createStableSnapshot(library.rootPath, identity.machineId, config.stabilityWindowSeconds), loadConflicts(config)]); const accepted = await acceptHandoff(library.rootPath, id, identity, snapshot, config, { blockingConflicts: conflicts.filter(isBlockingKnowledgeConflict).length, placeholderCount: 0 }); return NextResponse.json({ handoff: accepted, next: "Acquérez explicitement l’autorité writer après cette acceptation." }); } catch (error) { return portabilityApiError(error, 409); } }

