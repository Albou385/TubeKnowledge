import type { LibraryEnvironment } from "@/lib/config/library-config";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { latestCheckpoint } from "./checkpoints";
import { getPortabilityConfig } from "./config";
import { isBlockingKnowledgeConflict, loadConflicts } from "./conflicts";
import { PortabilityError } from "./errors";
import { loadMachineIdentity } from "./machine-identity";
import { inspectPortabilityReadiness } from "./readiness";
import { createStableSnapshot } from "./snapshots";
import type { VaultSnapshot } from "./types";
import { assertWriterAuthority } from "./writer-authority";

export interface SafetyGateResult { enabled: boolean; machineId?: string; rootHash?: string; checkpointId?: string; snapshot?: VaultSnapshot }
export async function assertPortabilityWriteAllowed(environment: LibraryEnvironment = process.env, options: { now?: Date; wait?: (milliseconds: number) => Promise<void>; requireRecentBackup?: boolean; verifiedBackupId?: string; allowConflictId?: string } = {}): Promise<SafetyGateResult> {
  const config = getPortabilityConfig(environment); if (!config.enabled) return { enabled: false };
  const library = parseLibraryConfig(environment); if (!library.ok) throw new PortabilityError("VAULT_UNAVAILABLE"); const identity = await loadMachineIdentity(config); if (!identity) throw new PortabilityError("PORTABILITY_NOT_CONFIGURED");
  const readiness = await inspectPortabilityReadiness(library.rootPath, config, identity, environment, options.now); if (readiness.status === "offline-placeholder") throw new PortabilityError("PLACEHOLDER_DETECTED"); if (readiness.status !== "ready-local") throw new PortabilityError(readiness.status === "writer-active-elsewhere" ? "WRITER_ACTIVE_ELSEWHERE" : "VAULT_UNAVAILABLE");
  const authority = await assertWriterAuthority(library.rootPath, identity, options.now); const checkpoint = await latestCheckpoint(library.rootPath); if (!checkpoint || authority.checkpointId !== checkpoint.checkpointId) throw new PortabilityError("CHECKPOINT_MISMATCH");
  const conflicts = await loadConflicts(config); if (conflicts.some((item) => isBlockingKnowledgeConflict(item) && item.conflictId !== options.allowConflictId && !(options.allowConflictId && item.type === "checkpoint-mismatch"))) throw new PortabilityError("CONFLICTS_BLOCKING"); if (options.requireRecentBackup && !options.verifiedBackupId) throw new PortabilityError("BACKUP_REQUIRED");
  const snapshot = await createStableSnapshot(library.rootPath, identity.machineId, config.stabilityWindowSeconds, { now: options.now, wait: options.wait }); if (!options.allowConflictId && snapshot.rootHash !== checkpoint.rootHash) throw new PortabilityError("CHECKPOINT_MISMATCH"); return { enabled: true, machineId: identity.machineId, rootHash: snapshot.rootHash, checkpointId: checkpoint.checkpointId, snapshot };
}
