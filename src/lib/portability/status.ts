import type { LibraryEnvironment } from "@/lib/config/library-config";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { listBackupRecords } from "./backup-reader";
import { latestCheckpoint } from "./checkpoints";
import { getPortabilityConfig } from "./config";
import { isBlockingKnowledgeConflict, isTechnicalWriterConflict, loadConflicts } from "./conflicts";
import { listHandoffs } from "./handoff";
import { readPortabilityHistory } from "./history";
import { loadMachineIdentity } from "./machine-identity";
import { loadOperationSettings } from "./operation-settings";
import { inspectPortabilityReadiness, type PortabilityReadiness } from "./readiness";
import { readWriterAuthority } from "./writer-authority";
import { deriveEffectiveWriterState } from "./writer-state";

const unavailableReadiness: PortabilityReadiness = {
  status: "handoff-required",
  localState: "État local incertain",
  cloudState: "Synchronisation cloud non vérifiée",
  vaultPresent: false,
  oneDriveProbable: false,
  placeholders: [],
  reparsePoints: [],
  message: "Configurez cette machine pour activer la portabilité.",
};

function ageSeconds(date: string | undefined, now: Date): number | null {
  return date ? Math.max(0, Math.floor((now.getTime() - new Date(date).getTime()) / 1000)) : null;
}

export async function getPortabilityStatus(environment: LibraryEnvironment = process.env, now = new Date()) {
  const config = getPortabilityConfig(environment);
  const library = parseLibraryConfig(environment);
  const identity = await loadMachineIdentity(config);
  const settings = await loadOperationSettings(config);

  if (!config.enabled || !library.ok) {
    const readiness = library.ok ? unavailableReadiness : { ...unavailableReadiness, status: "vault-missing" as const, localState: "État local indisponible" as const, message: "Le vault local n’est pas configuré." };
    const effective = deriveEffectiveWriterState({ authority: null, identity, initialized: false, conflicts: [], readiness, now });
    return {
      enabled: config.enabled,
      configured: Boolean(identity),
      readiness,
      machine: identity ? { machineId: identity.machineId, displayName: identity.displayName, rolePreference: identity.rolePreference } : null,
      writer: { ...effective, recommendedAction: "configure" as const, status: "absent" as const, active: false, local: false, machineId: null, displayName: null },
      checkpoint: null,
      conflicts: { open: 0, blocking: 0, knowledge: 0, technical: 0 },
      backups: { count: 0, verified: 0, bytes: 0, latest: null },
      lastLocalCheck: null,
      operationSettings: settings,
    };
  }

  const [readiness, authority, checkpoint, conflicts, backups, handoffs, history] = await Promise.all([
    inspectPortabilityReadiness(library.rootPath, config, identity, environment, now),
    readWriterAuthority(library.rootPath),
    latestCheckpoint(library.rootPath),
    loadConflicts(config),
    listBackupRecords(config),
    listHandoffs(library.rootPath),
    readPortabilityHistory(config.statePath),
  ]);
  const open = conflicts.filter((item) => item.status === "open");
  const initialized = Boolean(authority || checkpoint || history.some((entry) => entry.event === "writer-bootstrap"));
  const effective = deriveEffectiveWriterState({ authority, identity, initialized, conflicts, readiness, handoffs, now });
  const lastLocalEvent = history.find((entry) => entry.event === "snapshot-created" || entry.event === "diagnostic-run");
  const writerStatus = !authority ? "absent" : authority.status === "released" ? "released" : effective.leaseValid ? "active" : "expired";

  return {
    enabled: true,
    configured: Boolean(identity),
    readiness,
    machine: identity ? { machineId: identity.machineId, displayName: identity.displayName, rolePreference: identity.rolePreference } : null,
    writer: {
      ...effective,
      machineId: authority?.machineId || null,
      displayName: authority?.displayName || null,
      status: writerStatus,
      active: effective.leaseValid,
      local: effective.ownedByLocalMachine,
    },
    checkpoint: checkpoint ? {
      checkpointId: checkpoint.checkpointId,
      rootHash: checkpoint.rootHash.slice(0, 12),
      createdAt: checkpoint.createdAt,
      ageSeconds: ageSeconds(checkpoint.createdAt, now),
      action: checkpoint.action,
      backupId: checkpoint.backupId || null,
    } : null,
    conflicts: {
      open: open.length,
      blocking: open.filter(isBlockingKnowledgeConflict).length,
      knowledge: open.filter((item) => !isTechnicalWriterConflict(item)).length,
      technical: open.filter(isTechnicalWriterConflict).length,
    },
    backups: {
      count: backups.length,
      verified: backups.filter((item) => item.verified).length,
      bytes: backups.reduce((sum, item) => sum + item.zipBytes, 0),
      latest: backups[0] ? {
        backupId: backups[0].backupId,
        createdAt: backups[0].manifest.createdAt,
        ageSeconds: ageSeconds(backups[0].manifest.createdAt, now),
        verified: backups[0].verified,
        profile: backups[0].manifest.profile,
        rootHash: backups[0].manifest.sourceRootHash.slice(0, 12),
        trigger: backups[0].manifest.provenance?.trigger || "unknown",
        pinned: backups[0].pinned,
      } : null,
    },
    lastLocalCheck: lastLocalEvent ? { timestamp: lastLocalEvent.timestamp, ageSeconds: ageSeconds(lastLocalEvent.timestamp, now) } : null,
    operationSettings: settings,
  };
}
