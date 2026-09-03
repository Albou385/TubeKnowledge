import type { LibraryEnvironment } from "@/lib/config/library-config";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { listBackupRecords } from "./backup-reader";
import { listCheckpoints } from "./checkpoints";
import { getPortabilityConfig } from "./config";
import { describeConflict, isBlockingKnowledgeConflict, loadConflicts } from "./conflicts";
import { listHandoffs } from "./handoff";
import { loadMachineIdentity } from "./machine-identity";
import { createVaultSnapshot } from "./snapshots";
import { getPortabilityStatus } from "./status";
import { readWriterAuthority } from "./writer-authority";

export interface DiagnosticIssue {
  level: "informational" | "warning" | "blocking";
  code: string;
  message: string;
}

export async function diagnosePortabilityState(environment: LibraryEnvironment = process.env, now = new Date()) {
  const config = getPortabilityConfig(environment);
  const library = parseLibraryConfig(environment);
  const identity = await loadMachineIdentity(config);
  if (!config.enabled || !library.ok) {
    return {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      readOnly: true,
      cloudVerified: false,
      writer: { state: "unavailable", initialized: false, canWrite: false, recommendedAction: "configure" },
      availability: { localState: "État local indisponible", placeholders: [], reparsePoints: [] },
      checkpoint: null,
      checkpoints: [],
      backups: [],
      conflicts: [],
      issues: [{ level: "blocking", code: "PORTABILITY_NOT_CONFIGURED", message: "La configuration locale est incomplète." }] satisfies DiagnosticIssue[],
    };
  }

  const [status, authority, checkpoints, backups, conflicts, handoffs, snapshot] = await Promise.all([
    getPortabilityStatus(environment, now),
    readWriterAuthority(library.rootPath),
    listCheckpoints(library.rootPath),
    listBackupRecords(config),
    loadConflicts(config),
    listHandoffs(library.rootPath),
    identity ? createVaultSnapshot(library.rootPath, identity.machineId, { now }) : Promise.resolve(null),
  ]);
  const issues: DiagnosticIssue[] = [];
  if (status.writer.state === "expired-local" || status.writer.state === "expired-remote") issues.push({ level: "warning", code: status.writer.state.toUpperCase().replace("-", "_"), message: "Le document writer persiste, mais son lease est expiré." });
  if (status.readiness.placeholders.length) issues.push({ level: "blocking", code: "PLACEHOLDER_DETECTED", message: "Des fichiers de connaissance ne sont pas hydratés localement." });
  if (status.readiness.reparsePoints.length) issues.push({ level: "blocking", code: "REPARSE_POINT_DETECTED", message: "Un reparse point interdit a été détecté." });
  for (const item of conflicts.filter(isBlockingKnowledgeConflict)) issues.push({ level: "blocking", code: item.type.toUpperCase().replaceAll("-", "_"), message: describeConflict(item).impact });
  if (conflicts.some((value) => value.type === "stale-writer-authority" && value.status === "open")) issues.push({ level: "informational", code: "LEGACY_STALE_WRITER_CONFLICT", message: "Ancien enregistrement technique conservé; il ne représente pas une divergence Markdown." });
  if (!issues.length) issues.push({ level: "informational", code: "LOCAL_STATE_READABLE", message: "L’état local est lisible. Le cloud reste non vérifié." });
  const duplicateGroups = new Map<string, string[]>();
  for (const item of checkpoints) {
    const key = `${item.machineId}:${item.action}:${item.rootHash}:${item.backupId || ""}`;
    duplicateGroups.set(key, [...(duplicateGroups.get(key) || []), item.checkpointId]);
  }

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    readOnly: true,
    cloudVerified: false,
    machine: identity ? { machineId: identity.machineId, displayName: identity.displayName, rolePreference: identity.rolePreference } : null,
    writer: {
      state: status.writer.state,
      persistentStatus: authority?.status || "absent",
      documentPresent: status.writer.documentPresent,
      machineId: authority?.machineId || null,
      displayName: authority?.displayName || null,
      grantedAt: authority?.grantedAt || null,
      expiresAt: authority?.expiresAt || null,
      leaseValid: status.writer.leaseValid,
      ownedByLocalMachine: status.writer.ownedByLocalMachine,
      initialized: status.writer.initialized,
      canWrite: status.writer.canWrite,
      recommendedAction: status.writer.recommendedAction,
    },
    availability: {
      localState: status.readiness.localState,
      cloudState: status.readiness.cloudState,
      placeholders: status.readiness.placeholders,
      reparsePoints: status.readiness.reparsePoints,
    },
    snapshot: snapshot ? { rootHash: snapshot.rootHash, fileCount: snapshot.fileCount, totalBytes: snapshot.totalBytes } : null,
    checkpoint: checkpoints[0] || null,
    checkpoints: checkpoints.map((item) => ({ checkpointId: item.checkpointId, createdAt: item.createdAt, action: item.action, rootHash: item.rootHash, backupId: item.backupId || null, machineId: item.machineId })),
    logicalCheckpointDuplicates: [...duplicateGroups.values()].filter((ids) => ids.length > 1),
    backups: backups.map((item) => ({ backupId: item.backupId, profile: item.manifest.profile, createdAt: item.manifest.createdAt, rootHash: item.manifest.sourceRootHash, verified: item.verified, pinned: item.pinned, zipBytes: item.zipBytes, trigger: item.manifest.provenance?.trigger || "unknown" })),
    conflicts: conflicts.map((item) => ({ conflictId: item.conflictId, type: item.type, category: describeConflict(item).category, detectedAt: item.detectedAt, paths: Array.isArray(item.paths) ? item.paths : [], baseCheckpointId: item.baseCheckpointId || null, severity: item.severity, effectiveBlocking: isBlockingKnowledgeConflict(item), status: item.status, reason: item.evidence.reason, recommendedAction: describeConflict(item).recommendedAction })),
    handoffs: handoffs.map((item) => ({ handoffId: item.handoffId, sourceMachineId: item.sourceMachineId, targetMachineId: item.targetMachineId || null, createdAt: item.createdAt, expiresAt: item.expiresAt, status: item.status })),
    operationSettings: status.operationSettings,
    issues,
  };
}

export async function planPortabilityRecovery(environment: LibraryEnvironment = process.env, now = new Date()) {
  const diagnostic = await diagnosePortabilityState(environment, now);
  const steps: string[] = [
    "Conserver tous les backups, checkpoints, conflits et historiques existants.",
    "Vérifier que le vault est hydraté et localement stable; cette vérification ne certifie pas OneDrive.",
  ];
  if (diagnostic.conflicts.some((item) => item.effectiveBlocking)) steps.push("Examiner chaque conflit de connaissance bloquant et préparer toute correction via Preview/Apply Phase 3.");
  if (diagnostic.writer.state === "expired-local") {
    steps.push("Sélectionner un backup vérifié dont le rootHash correspond au snapshot courant.");
    steps.push("Vérifier qu’aucun handoff valide n’est en attente.");
    steps.push("Exécuter explicitement Réacquérir writer avec la confirmation REACQUERIR.");
  } else if (diagnostic.writer.state === "active-local") {
    steps.push("Renouveler explicitement le lease avant son expiration si nécessaire.");
  } else if (diagnostic.writer.state === "uninitialized") {
    steps.push("Effectuer le bootstrap initial une seule fois avec un backup vérifié.");
  } else if (diagnostic.writer.state === "active-remote" || diagnostic.writer.state === "expired-remote") {
    steps.push("Ne pas acquérir writer sur cette machine; utiliser le handoff depuis la machine propriétaire.");
  }
  steps.push("Relancer le diagnostic read-only et confirmer canWrite, checkpoint et backup avant toute écriture.");
  return { schemaVersion: 1, generatedAt: now.toISOString(), readOnly: true, appliesChanges: false, writerState: diagnostic.writer.state, steps };
}
