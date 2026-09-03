import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { verifyPortabilityBackup } from "./backup-reader";
import { latestCheckpoint } from "./checkpoints";
import { getPortabilityConfig } from "./config";
import { PORTABILITY_LIMITS } from "./constants";
import { looksLikeConflictCopy } from "./conflict-patterns";
import { loadConflicts } from "./conflicts";
import { PortabilityError } from "./errors";
import { atomicWriteJson } from "./filesystem";
import { listHandoffs } from "./handoff";
import { appendPortabilityHistoryOnce } from "./history";
import { loadMachineIdentity } from "./machine-identity";
import { inspectPortabilityReadiness } from "./readiness";
import { createStableSnapshot } from "./snapshots";
import { listExtendedAbsenceHandoffs } from "./travel-handoff";
import type { Checkpoint, MachineIdentity, VaultSnapshot, WriterAuthority } from "./types";
import { isAuthorityActive, readWriterAuthority, recoverExpiredRemoteWriterAuthority, writerAuthorityPath } from "./writer-authority";
import { acquireWriterOperationLock } from "./writer-operation-lock";
import { acquireSharedWriterTransitionClaim } from "./writer-transition-claim";

const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const authoritySchema = z.object({
  schemaVersion: z.literal(1), authorityId: uuid, machineId: uuid, displayName: z.string().min(1).max(80),
  grantedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), checkpointId: uuid, status: z.enum(["active", "released"]),
}).strict();
const checkpointSchema = z.object({
  schemaVersion: z.literal(1), checkpointId: uuid, rootHash: hash, machineId: uuid,
  action: z.enum(["import", "restore", "conflict-resolved", "handoff", "backup"]), createdAt: z.iso.datetime(),
  importId: uuid.optional(), restoreId: uuid.optional(), conflictId: uuid.optional(), backupId: uuid.optional(),
}).strict();

export const writerDisasterRecoveryPreviewRequestSchema = z.object({ backupId: uuid }).strict();
export const writerDisasterRecoveryApplyRequestSchema = z.object({
  recoveryId: uuid,
  confirmationText: z.literal("REPRENDRE LE WRITER SUR CE PORTABLE"),
}).strict();
export const writerDisasterRecoveryResumeRequestSchema = writerDisasterRecoveryApplyRequestSchema;

const previewSchema = z.object({
  schemaVersion: z.literal(1),
  recoveryId: uuid,
  machineId: uuid,
  sourceMachineId: uuid,
  sourceAuthorityId: uuid,
  checkpointId: uuid,
  backupId: uuid,
  rootHash: hash,
  writerExpiredAt: z.iso.datetime(),
  eligibleAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  risks: z.array(z.string().min(1).max(300)).min(1).max(8),
  status: z.literal("ready"),
}).strict();

const resultSchema = z.object({
  operation: z.literal("disaster-recovery"),
  idempotencyKey: uuid,
  recoveryId: uuid,
  sourceMachineId: uuid,
  recoveredAt: z.iso.datetime(),
  authority: authoritySchema,
  checkpoint: checkpointSchema,
}).strict();

const operationSchema = z.object({
  schemaVersion: z.literal(1),
  idempotencyKey: uuid,
  recoveryId: uuid,
  machineId: uuid,
  backupId: uuid,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  status: z.enum(["in-progress", "success"]),
  result: resultSchema.optional(),
}).strict();

export type WriterDisasterRecoveryPreview = z.infer<typeof previewSchema>;
export type WriterDisasterRecoveryResult = z.infer<typeof resultSchema>;

export interface WriterDisasterRecoveryOptions {
  now?: Date;
  wait?: (milliseconds: number) => Promise<void>;
  lockWait?: (milliseconds: number) => Promise<void>;
  failAfterAuthorityWrite?: boolean;
  failAfterAuditWrite?: boolean;
  simulateCrashAfterAuthorityWrite?: boolean;
}

interface RecoveryContext {
  config: ReturnType<typeof getPortabilityConfig>;
  libraryPath: string;
  identity: MachineIdentity;
  snapshot: VaultSnapshot;
  authority: WriterAuthority;
  checkpoint: Checkpoint;
}

function previewPath(statePath: string, recoveryId: string): string {
  return path.join(statePath, "writer-disaster-recovery-previews", `${uuid.parse(recoveryId)}.json`);
}

function operationPath(statePath: string, idempotencyKey: string): string {
  return path.join(statePath, "writer-disaster-recovery-operations", `${uuid.parse(idempotencyKey)}.json`);
}

async function readJson<T>(target: string, schema: z.ZodType<T>): Promise<T | null> {
  try { return schema.parse(JSON.parse(await readFile(target, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function listOperationRecords(statePath: string): Promise<Array<z.infer<typeof operationSchema>>> {
  const directory = path.join(statePath, "writer-disaster-recovery-operations");
  try {
    const names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    return await Promise.all(names.map(async (name) => operationSchema.parse(JSON.parse(await readFile(path.join(directory, name), "utf8")))));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT", { cause: error });
  }
}

export interface PendingWriterDisasterRecovery {
  recoveryId: string;
  startedAt: string;
  sourceMachineId: string;
}

async function findCommittedPendingRecovery(
  environment: LibraryEnvironment,
  recoveryId?: string,
): Promise<{ operation: z.infer<typeof operationSchema>; preview: WriterDisasterRecoveryPreview } | null> {
  const config = getPortabilityConfig(environment);
  const library = parseLibraryConfig(environment);
  const identity = await loadMachineIdentity(config);
  if (!config.enabled || !library.ok || !identity) return null;
  const authority = await readWriterAuthority(library.rootPath);
  if (!authority || authority.machineId !== identity.machineId) return null;
  const operations = (await listOperationRecords(config.statePath))
    .filter((item) => item.status === "in-progress"
      && item.machineId === identity.machineId
      && item.idempotencyKey === authority.authorityId
      && (!recoveryId || item.recoveryId === recoveryId))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const operation = operations[0];
  if (!operation) return null;
  const preview = await readJson(previewPath(config.statePath, operation.recoveryId), previewSchema);
  if (!preview
    || preview.machineId !== identity.machineId
    || preview.checkpointId !== authority.checkpointId) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
  return { operation, preview };
}

export async function discoverPendingWriterDisasterRecovery(
  environment: LibraryEnvironment = process.env,
): Promise<PendingWriterDisasterRecovery | null> {
  const pending = await findCommittedPendingRecovery(environment);
  if (!pending) return null;
  return {
    recoveryId: pending.operation.recoveryId,
    startedAt: pending.operation.createdAt,
    sourceMachineId: pending.preview.sourceMachineId,
  };
}

export async function resumePendingWriterDisasterRecovery(
  input: { recoveryId: string; confirmationText?: string },
  environment: LibraryEnvironment = process.env,
  options: WriterDisasterRecoveryOptions = {},
): Promise<WriterDisasterRecoveryResult> {
  if (input.confirmationText !== "REPRENDRE LE WRITER SUR CE PORTABLE") throw new PortabilityError("WRITER_DISASTER_RECOVERY_CONFIRMATION_REQUIRED");
  const { recoveryId } = writerDisasterRecoveryResumeRequestSchema.parse({ recoveryId: input.recoveryId, confirmationText: input.confirmationText });
  const pending = await findCommittedPendingRecovery(environment, recoveryId);
  if (!pending) throw new PortabilityError("WRITER_DISASTER_RECOVERY_PREVIEW_REQUIRED");
  return applyWriterDisasterRecovery({
    idempotencyKey: pending.operation.idempotencyKey,
    recoveryId,
    confirmationText: input.confirmationText,
  }, environment, options);
}

function sameAuthority(left: WriterAuthority, right: WriterAuthority): boolean {
  return left.authorityId === right.authorityId
    && left.machineId === right.machineId
    && left.checkpointId === right.checkpointId
    && left.expiresAt === right.expiresAt
    && left.status === right.status;
}

async function validateRecoveryContext(
  backupId: string,
  environment: LibraryEnvironment,
  now: Date,
  wait?: (milliseconds: number) => Promise<void>,
): Promise<RecoveryContext> {
  const config = getPortabilityConfig(environment);
  const library = parseLibraryConfig(environment);
  const identity = await loadMachineIdentity(config);
  if (!config.enabled || !library.ok || !identity) throw new PortabilityError("PORTABILITY_NOT_CONFIGURED");

  const authorityBefore = await readWriterAuthority(library.rootPath);
  if (!authorityBefore
    || authorityBefore.status !== "active"
    || authorityBefore.machineId === identity.machineId) throw new PortabilityError("WRITER_DISASTER_RECOVERY_NOT_ALLOWED");
  if (isAuthorityActive(authorityBefore, now)) throw new PortabilityError("WRITER_ACTIVE_REMOTE");
  const eligibleAt = new Date(new Date(authorityBefore.expiresAt).getTime() + PORTABILITY_LIMITS.writerDisasterRecoveryDelayMs);
  if (eligibleAt.getTime() > now.getTime()) throw new PortabilityError("WRITER_DISASTER_RECOVERY_DELAY_ACTIVE");

  const readiness = await inspectPortabilityReadiness(library.rootPath, config, identity, environment, now);
  if (readiness.status === "offline-placeholder") throw new PortabilityError("PLACEHOLDER_DETECTED");
  if (readiness.status !== "ready-local") throw new PortabilityError("VAULT_UNAVAILABLE");
  if ((await loadConflicts(config)).some((item) => item.status === "open")) throw new PortabilityError("WRITER_DISASTER_RECOVERY_CONFLICTS_PRESENT");

  const [handoffs, extendedHandoffs] = await Promise.all([
    listHandoffs(library.rootPath),
    listExtendedAbsenceHandoffs(library.rootPath),
  ]);
  const hasActiveNormalHandoff = handoffs.some((item) => (item.status === "prepared" || item.status === "accepted") && new Date(item.expiresAt).getTime() > now.getTime());
  const hasActiveExtendedHandoff = extendedHandoffs.some((item) => (item.status === "prepared" || item.status === "accepted") && new Date(item.expiresAt).getTime() > now.getTime());
  if (hasActiveNormalHandoff || hasActiveExtendedHandoff) throw new PortabilityError("WRITER_DISASTER_RECOVERY_HANDOFF_ACTIVE");

  let snapshot: VaultSnapshot;
  try {
    snapshot = await createStableSnapshot(library.rootPath, identity.machineId, config.stabilityWindowSeconds, { now, wait });
  } catch (error) {
    if (error instanceof PortabilityError) throw error;
    if (error instanceof Error && error.message === "VAULT_UNSTABLE") throw new PortabilityError("VAULT_UNSTABLE");
    throw new PortabilityError("VAULT_UNAVAILABLE");
  }

  const authorityAfter = await readWriterAuthority(library.rootPath);
  if (!authorityAfter || !sameAuthority(authorityBefore, authorityAfter) || isAuthorityActive(authorityAfter, now)) {
    throw new PortabilityError("WRITER_DISASTER_RECOVERY_STATE_CHANGED");
  }
  const checkpoint = await latestCheckpoint(library.rootPath);
  if (!checkpoint
    || checkpoint.checkpointId !== authorityAfter.checkpointId
    || checkpoint.machineId !== authorityAfter.machineId
    || checkpoint.rootHash !== snapshot.rootHash) throw new PortabilityError("CHECKPOINT_MISMATCH");
  if ((await loadConflicts(config)).some((item) => item.status === "open")
    || snapshot.files.some((item) => looksLikeConflictCopy(item.path))) {
    throw new PortabilityError("WRITER_DISASTER_RECOVERY_CONFLICTS_PRESENT");
  }

  let backup;
  try { backup = await verifyPortabilityBackup(config, backupId); }
  catch { throw new PortabilityError("WRITER_DISASTER_RECOVERY_BACKUP_REQUIRED"); }
  if (!backup.record.verified
    || backup.record.manifest.profile !== "knowledge"
    || backup.record.manifest.sourceRootHash !== snapshot.rootHash) {
    throw new PortabilityError("WRITER_DISASTER_RECOVERY_BACKUP_REQUIRED");
  }
  return { config, libraryPath: library.rootPath, identity, snapshot, authority: authorityAfter, checkpoint };
}

export async function previewWriterDisasterRecovery(
  input: { backupId: string },
  environment: LibraryEnvironment = process.env,
  options: WriterDisasterRecoveryOptions = {},
): Promise<WriterDisasterRecoveryPreview> {
  const { backupId } = writerDisasterRecoveryPreviewRequestSchema.parse(input);
  const now = options.now || new Date();
  const recoveryId = randomUUID();
  const config = getPortabilityConfig(environment);
  const lock = await acquireWriterOperationLock(config, recoveryId, options.lockWait);
  try {
    const current = await validateRecoveryContext(backupId, environment, now, options.wait);
    const preview = previewSchema.parse({
      schemaVersion: 1,
      recoveryId,
      machineId: current.identity.machineId,
      sourceMachineId: current.authority.machineId,
      sourceAuthorityId: current.authority.authorityId,
      checkpointId: current.checkpoint.checkpointId,
      backupId,
      rootHash: current.snapshot.rootHash,
      writerExpiredAt: current.authority.expiresAt,
      eligibleAt: new Date(new Date(current.authority.expiresAt).getTime() + PORTABILITY_LIMITS.writerDisasterRecoveryDelayMs).toISOString(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PORTABILITY_LIMITS.writerDisasterRecoveryPreviewTtlMs).toISOString(),
      risks: [
        "Cette procédure est réservée à la perte définitive de la machine source.",
        "TubeKnowledge ne peut pas certifier que OneDrive a fini sa synchronisation.",
        "Une reprise incorrecte pendant que la source fonctionne encore peut créer deux writers.",
        "Apply remplace uniquement l’autorité expirée; il ne modifie ni les connaissances ni le checkpoint.",
      ],
      status: "ready",
    });
    await atomicWriteJson(previewPath(current.config.statePath, recoveryId), preview, true);
    return preview;
  } finally {
    await lock.release();
  }
}

function assertPreviewMatches(preview: WriterDisasterRecoveryPreview, current: RecoveryContext, now: Date): void {
  if (new Date(preview.expiresAt).getTime() <= now.getTime()) throw new PortabilityError("WRITER_DISASTER_RECOVERY_PREVIEW_REQUIRED");
  if (preview.machineId !== current.identity.machineId
    || preview.sourceMachineId !== current.authority.machineId
    || preview.sourceAuthorityId !== current.authority.authorityId
    || preview.checkpointId !== current.checkpoint.checkpointId
    || preview.rootHash !== current.snapshot.rootHash) throw new PortabilityError("WRITER_DISASTER_RECOVERY_STATE_CHANGED");
}

export async function applyWriterDisasterRecovery(
  input: { idempotencyKey: string; recoveryId: string; confirmationText?: string },
  environment: LibraryEnvironment = process.env,
  options: WriterDisasterRecoveryOptions = {},
): Promise<WriterDisasterRecoveryResult> {
  const idempotencyKey = uuid.parse(input.idempotencyKey);
  if (input.confirmationText !== "REPRENDRE LE WRITER SUR CE PORTABLE") throw new PortabilityError("WRITER_DISASTER_RECOVERY_CONFIRMATION_REQUIRED");
  const { recoveryId } = writerDisasterRecoveryApplyRequestSchema.parse({ recoveryId: input.recoveryId, confirmationText: input.confirmationText });
  const requestedAt = options.now || new Date();
  const config = getPortabilityConfig(environment);
  const identity = await loadMachineIdentity(config);
  if (!identity) throw new PortabilityError("PORTABILITY_NOT_CONFIGURED");
  const library = parseLibraryConfig(environment);
  if (!library.ok) throw new PortabilityError("PORTABILITY_NOT_CONFIGURED");
  const lock = await acquireWriterOperationLock(config, idempotencyKey, options.lockWait);
  try {
    const sharedClaim = await acquireSharedWriterTransitionClaim(library.rootPath, idempotencyKey, identity.machineId);
    try {
      const operation = await readJson(operationPath(config.statePath, idempotencyKey), operationSchema);
      if (operation) {
        if (operation.recoveryId !== recoveryId || operation.machineId !== identity.machineId) throw new PortabilityError("IDEMPOTENCY_CONFLICT");
        if (operation.status === "success" && operation.result) {
          if (new Date(operation.expiresAt).getTime() <= requestedAt.getTime()) throw new PortabilityError("IDEMPOTENCY_KEY_INVALID");
          return resultSchema.parse(operation.result);
        }
      }
      const preview = await readJson(previewPath(config.statePath, recoveryId), previewSchema);
      if (!preview || preview.machineId !== identity.machineId) throw new PortabilityError("WRITER_DISASTER_RECOVERY_PREVIEW_REQUIRED");
      const currentAuthority = await readWriterAuthority(library.rootPath);
      if (operation?.status === "in-progress"
        && currentAuthority?.authorityId === idempotencyKey
        && currentAuthority.machineId === identity.machineId
        && currentAuthority.checkpointId === preview.checkpointId) {
        const checkpoint = await latestCheckpoint(library.rootPath);
        if (!checkpoint || checkpoint.checkpointId !== preview.checkpointId || checkpoint.rootHash !== preview.rootHash) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
        const result = resultSchema.parse({ operation: "disaster-recovery", idempotencyKey, recoveryId, sourceMachineId: preview.sourceMachineId, recoveredAt: operation.createdAt, authority: currentAuthority, checkpoint });
        await appendPortabilityHistoryOnce(config.statePath, { schemaVersion: 1, eventId: idempotencyKey, event: "writer-disaster-recovered", timestamp: operation.createdAt, machineId: identity.machineId, sourceMachineId: preview.sourceMachineId, relatedId: currentAuthority.authorityId, status: "recovered-after-remote-expiry" });
        await atomicWriteJson(operationPath(config.statePath, idempotencyKey), operationSchema.parse({ ...operation, status: "success", result }));
        return result;
      }
      if (operation && new Date(operation.expiresAt).getTime() <= requestedAt.getTime()) throw new PortabilityError("IDEMPOTENCY_KEY_INVALID");
      if (new Date(preview.expiresAt).getTime() <= requestedAt.getTime()) throw new PortabilityError("WRITER_DISASTER_RECOVERY_PREVIEW_REQUIRED");

      const current = await validateRecoveryContext(preview.backupId, environment, requestedAt, options.wait);
      assertPreviewMatches(preview, current, requestedAt);
      const createdAt = operation ? new Date(operation.createdAt) : requestedAt;
      const pending = operation || operationSchema.parse({
        schemaVersion: 1,
        idempotencyKey,
        recoveryId,
        machineId: identity.machineId,
        backupId: preview.backupId,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + PORTABILITY_LIMITS.writerOperationIdempotencyTtlMs).toISOString(),
        status: "in-progress",
      });
      if (!operation) await atomicWriteJson(operationPath(config.statePath, idempotencyKey), pending, true);

      let recovered: WriterAuthority | null = null;
      let auditCommitted = false;
      try {
        recovered = await recoverExpiredRemoteWriterAuthority(current.libraryPath, current.identity, current.checkpoint, current.authority, current.config.writerLeaseMinutes, createdAt, idempotencyKey);
        if (options.simulateCrashAfterAuthorityWrite) throw new Error("SIMULATED_PROCESS_CRASH");
        if (options.failAfterAuthorityWrite) throw new Error("FAIL_AFTER_AUTHORITY_WRITE");
        const persisted = await readWriterAuthority(current.libraryPath);
        if (!persisted || !sameAuthority(persisted, recovered)) throw new PortabilityError("WRITER_DISASTER_RECOVERY_STATE_CHANGED");
        await appendPortabilityHistoryOnce(config.statePath, { schemaVersion: 1, eventId: idempotencyKey, event: "writer-disaster-recovered", timestamp: createdAt.toISOString(), machineId: identity.machineId, sourceMachineId: preview.sourceMachineId, relatedId: recovered.authorityId, status: "recovered-after-remote-expiry" });
        auditCommitted = true;
        if (options.failAfterAuditWrite) throw new Error("FAIL_AFTER_AUDIT_WRITE");
        const result = resultSchema.parse({ operation: "disaster-recovery", idempotencyKey, recoveryId, sourceMachineId: preview.sourceMachineId, recoveredAt: createdAt.toISOString(), authority: recovered, checkpoint: current.checkpoint });
        await atomicWriteJson(operationPath(config.statePath, idempotencyKey), operationSchema.parse({ ...pending, status: "success", result }));
        return result;
      } catch (error) {
        if (recovered && !auditCommitted && !options.simulateCrashAfterAuthorityWrite) {
          try {
            const persisted = await readWriterAuthority(current.libraryPath);
            if (!persisted || !sameAuthority(persisted, recovered)) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
            await atomicWriteJson(writerAuthorityPath(current.libraryPath), current.authority);
          }
          catch (rollbackError) { throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT", { cause: rollbackError }); }
        }
        throw error;
      }
    } finally {
      await sharedClaim.release();
    }
  } finally {
    await lock.release();
  }
}
