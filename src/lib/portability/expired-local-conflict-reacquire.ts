import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { verifyPortabilityBackup } from "./backup-reader";
import { checkpointDirectory, createCheckpoint, latestCheckpoint, readCheckpoint } from "./checkpoints";
import { getPortabilityConfig, type PortabilityConfig } from "./config";
import { loadConflicts } from "./conflicts";
import { PortabilityError } from "./errors";
import { atomicWriteJson, windowsPathKey } from "./filesystem";
import { listHandoffs } from "./handoff";
import { appendPortabilityHistoryOnce } from "./history";
import { loadMachineIdentity } from "./machine-identity";
import { inspectPortabilityReadiness } from "./readiness";
import { changedKnowledgePaths, createStableSnapshot, persistLatestSnapshot, readLatestSnapshot } from "./snapshots";
import type { Checkpoint, VaultSnapshot, WriterAuthority } from "./types";
import { isAuthorityActive, reacquireWriterAuthority, readWriterAuthority, writerAuthorityPath } from "./writer-authority";
import { acquireWriterOperationLock } from "./writer-operation-lock";

const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const snapshotFileSchema = z.object({ path: z.string().min(1), size: z.number().int().nonnegative(), sha256: hash, modifiedAt: z.iso.datetime() }).strict();
const snapshotSchema = z.object({ schemaVersion: z.literal(1), snapshotId: uuid, createdAt: z.iso.datetime(), machineId: uuid, fileCount: z.number().int().nonnegative(), totalBytes: z.number().int().nonnegative(), rootHash: hash, files: z.array(snapshotFileSchema) }).strict();
const authoritySchema = z.object({ schemaVersion: z.literal(1), authorityId: uuid, machineId: uuid, displayName: z.string(), grantedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), checkpointId: uuid, status: z.enum(["active", "released"]) }).strict();
const checkpointSchema = z.object({ schemaVersion: z.literal(1), checkpointId: uuid, rootHash: hash, machineId: uuid, action: z.enum(["import", "restore", "conflict-resolved", "handoff", "backup"]), createdAt: z.iso.datetime(), importId: uuid.optional(), restoreId: uuid.optional(), conflictId: uuid.optional(), backupId: uuid.optional() }).strict();
const conflictSchema = z.object({ schemaVersion: z.literal(1), conflictId: uuid, type: z.enum(["content-divergence", "case-collision", "duplicate-suspected", "onedrive-conflict-copy", "deleted-vs-modified", "checkpoint-mismatch", "unexpected-system-change", "stale-writer-authority", "incomplete-placeholder"]), detectedAt: z.iso.datetime(), paths: z.array(z.string()), baseCheckpointId: uuid.optional(), severity: z.enum(["warning", "blocking"]), status: z.enum(["open", "resolved", "false-positive"]), evidence: z.object({ hashes: z.array(hash).optional(), sizes: z.array(z.number()).optional(), dates: z.array(z.string()).optional(), reason: z.string() }).strict() }).strict();
const rollbackSchema = z.object({ baseline: snapshotSchema, authority: authoritySchema, checkpoint: checkpointSchema, conflicts: z.array(conflictSchema), targetSnapshot: snapshotSchema, checkpointId: uuid, authorityId: uuid, phase: z.enum(["prepared", "baseline-persisted", "checkpoint-created", "authority-reacquired", "conflict-resolved", "history-appended"]) }).strict();
const resultSchema = z.object({ operation: z.literal("expired-local-conflict-reacquire"), idempotencyKey: uuid, conflict: z.object({ conflictId: uuid, status: z.literal("resolved") }).strict(), authority: authoritySchema, checkpoint: checkpointSchema }).strict();
const operationSchema = z.object({ schemaVersion: z.literal(2), idempotencyKey: uuid, conflictId: uuid, backupId: uuid, machineId: uuid, createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(), status: z.enum(["in-progress", "success"]), rollback: rollbackSchema, result: resultSchema.optional() }).strict();

export interface ExpiredLocalConflictReacquireResult { operation: "expired-local-conflict-reacquire"; idempotencyKey: string; conflict: { conflictId: string; status: "resolved" }; authority: WriterAuthority; checkpoint: Checkpoint; }
export const expiredLocalConflictReacquireRequestSchema = z.object({ backupId: uuid, confirmationText: z.literal("CONSERVER ET REACQUERIR") }).strict();

class SimulatedInterruption extends Error {}
function operationPath(config: PortabilityConfig, idempotencyKey: string): string { return path.join(config.statePath, "expired-local-conflict-reacquire", "operations", `${uuid.parse(idempotencyKey)}.json`); }
function conflictPath(config: PortabilityConfig): string { return path.join(config.statePath, "conflicts.json"); }

async function readOptional<T>(target: string, schema: z.ZodType<T>): Promise<T | null> {
  try { return schema.parse(JSON.parse(await readFile(target, "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT", { cause: error }); }
}

function assertOnlyAcceptedChanges(baseline: VaultSnapshot, current: VaultSnapshot, paths: string[]): void {
  const actual = changedKnowledgePaths(baseline, current).map(windowsPathKey);
  const accepted = [...new Set(paths.map(windowsPathKey))].sort((left, right) => left.localeCompare(right, "en"));
  if (!accepted.length || actual.length !== accepted.length || actual.some((item, index) => item !== accepted[index])) throw new PortabilityError("EXPIRED_LOCAL_CONFLICT_REACQUIRE_NOT_ALLOWED");
}

async function eligibleContext(conflictId: string, backupId: string, environment: LibraryEnvironment, now: Date, wait?: (milliseconds: number) => Promise<void>) {
  const config = getPortabilityConfig(environment); const library = parseLibraryConfig(environment); const identity = await loadMachineIdentity(config);
  if (!config.enabled || !library.ok || !identity) throw new PortabilityError("PORTABILITY_NOT_CONFIGURED");
  const readiness = await inspectPortabilityReadiness(library.rootPath, config, identity, environment, now);
  if (readiness.status === "offline-placeholder") throw new PortabilityError("PLACEHOLDER_DETECTED");
  if (readiness.status !== "ready-local") throw new PortabilityError("VAULT_UNAVAILABLE");
  const [authority, baseline, checkpoint, conflicts, handoffs] = await Promise.all([readWriterAuthority(library.rootPath), readLatestSnapshot(config), latestCheckpoint(library.rootPath), loadConflicts(config), listHandoffs(library.rootPath)]);
  if (!authority || authority.status !== "active" || isAuthorityActive(authority, now) || authority.machineId !== identity.machineId) throw new PortabilityError("EXPIRED_LOCAL_CONFLICT_REACQUIRE_NOT_ALLOWED");
  if (!baseline || !checkpoint || checkpoint.rootHash !== baseline.rootHash || authority.checkpointId !== checkpoint.checkpointId) throw new PortabilityError("EXPIRED_LOCAL_CONFLICT_REACQUIRE_NOT_ALLOWED");
  if (handoffs.some((item) => ["prepared", "accepted"].includes(item.status) && new Date(item.expiresAt).getTime() > now.getTime())) throw new PortabilityError("WRITER_REACQUIRE_BLOCKED_BY_HANDOFF");
  const conflict = conflicts.find((item) => item.conflictId === conflictId);
  if (!conflict || conflict.type !== "content-divergence" || conflict.severity !== "blocking" || conflict.status !== "open" || !conflict.paths.length) throw new PortabilityError("EXPIRED_LOCAL_CONFLICT_REACQUIRE_NOT_ALLOWED");
  if (conflicts.some((item) => item.conflictId !== conflictId && item.status === "open" && item.severity === "blocking")) throw new PortabilityError("CONFLICTS_BLOCKING");
  let snapshot: VaultSnapshot;
  try { snapshot = await createStableSnapshot(library.rootPath, identity.machineId, config.stabilityWindowSeconds, { now, wait }); }
  catch (error) { if (error instanceof PortabilityError) throw error; if (error instanceof Error && error.message === "VAULT_UNSTABLE") throw new PortabilityError("VAULT_UNSTABLE"); throw new PortabilityError("VAULT_UNAVAILABLE"); }
  assertOnlyAcceptedChanges(baseline, snapshot, conflict.paths);
  let backup; try { backup = await verifyPortabilityBackup(config, backupId); } catch { throw new PortabilityError("BACKUP_SNAPSHOT_MISMATCH"); }
  if (!backup.record.verified || backup.record.manifest.profile !== "knowledge" || backup.record.manifest.createdByMachineId !== identity.machineId || backup.record.manifest.sourceRootHash !== snapshot.rootHash) throw new PortabilityError("BACKUP_SNAPSHOT_MISMATCH");
  return { config, library, identity, authority, baseline, checkpoint, conflicts, conflict, snapshot };
}

async function assertCheckpointUnused(vaultPath: string, checkpointId: string): Promise<void> {
  try { await readCheckpoint(vaultPath, checkpointId); throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; if (error instanceof PortabilityError) throw error; throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT", { cause: error }); }
}

function belongsToOperation(checkpoint: Checkpoint, operation: z.infer<typeof operationSchema>): boolean {
  return checkpoint.checkpointId === operation.rollback.checkpointId && checkpoint.action === "conflict-resolved" && checkpoint.conflictId === operation.conflictId && checkpoint.rootHash === operation.rollback.targetSnapshot.rootHash && checkpoint.machineId === operation.machineId;
}

async function restoreIncompleteOperation(config: PortabilityConfig, libraryPath: string, operation: z.infer<typeof operationSchema>): Promise<void> {
  const rollback = operation.rollback;
  const [authority, baseline, conflicts] = await Promise.all([readWriterAuthority(libraryPath), readLatestSnapshot(config), loadConflicts(config)]);
  const authorityKnown = authority?.authorityId === rollback.authority.authorityId || (authority?.authorityId === rollback.authorityId && authority.machineId === operation.machineId && authority.checkpointId === rollback.checkpointId);
  const baselineKnown = baseline?.rootHash === rollback.baseline.rootHash || baseline?.rootHash === rollback.targetSnapshot.rootHash;
  const conflictStatus = conflicts.find((item) => item.conflictId === operation.conflictId)?.status;
  if (!authorityKnown || !baselineKnown || !["open", "resolved"].includes(conflictStatus || "")) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
  let createdCheckpoint: Checkpoint | null = null;
  try { createdCheckpoint = await readCheckpoint(libraryPath, rollback.checkpointId); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT", { cause: error }); }
  if (createdCheckpoint && !belongsToOperation(createdCheckpoint, operation)) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
  // Restore writer first: a replay never leaves canWrite enabled while rollback remains incomplete.
  await atomicWriteJson(writerAuthorityPath(libraryPath), rollback.authority);
  await persistLatestSnapshot(config, rollback.baseline);
  await atomicWriteJson(conflictPath(config), rollback.conflicts);
  if (createdCheckpoint) await rm(path.join(checkpointDirectory(libraryPath), `${rollback.checkpointId}.json`), { force: false });
}

async function replayResult(operation: z.infer<typeof operationSchema>, environment: LibraryEnvironment): Promise<ExpiredLocalConflictReacquireResult | null> {
  if (operation.status !== "success" || !operation.result) return null;
  const result = resultSchema.parse(operation.result) as ExpiredLocalConflictReacquireResult; const config = getPortabilityConfig(environment); const library = parseLibraryConfig(environment);
  if (!library.ok) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
  const [baseline, authority, conflicts, checkpoint] = await Promise.all([readLatestSnapshot(config), readWriterAuthority(library.rootPath), loadConflicts(config), latestCheckpoint(library.rootPath)]);
  if (baseline?.rootHash !== result.checkpoint.rootHash || authority?.authorityId !== result.authority.authorityId || authority.checkpointId !== result.checkpoint.checkpointId || checkpoint?.checkpointId !== result.checkpoint.checkpointId) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
  const conflict = conflicts.find((item) => item.conflictId === operation.conflictId);
  if (conflict?.status === "open") {
    const expectedOpen = operation.rollback.conflicts.find((item) => item.conflictId === operation.conflictId);
    if (!expectedOpen || JSON.stringify(conflict) !== JSON.stringify(expectedOpen)) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
    await atomicWriteJson(conflictPath(config), operation.rollback.conflicts.map((item) => item.conflictId === operation.conflictId ? { ...item, status: "resolved" } : item));
  } else if (conflict?.status !== "resolved") throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
  await appendPortabilityHistoryOnce(config.statePath, { schemaVersion: 1, eventId: operation.idempotencyKey, event: "expired-local-conflict-reacquired", timestamp: operation.createdAt, machineId: operation.machineId, relatedId: operation.conflictId, status: "resolved" });
  return result;
}

export async function canOfferExpiredLocalConflictReacquire(conflictId: string, environment: LibraryEnvironment = process.env): Promise<{ backupIds: string[] } | null> {
  const config = getPortabilityConfig(environment); const identity = await loadMachineIdentity(config); if (!identity) return null; const candidates: string[] = [];
  try { const { listBackupRecords } = await import("./backup-reader"); for (const record of await listBackupRecords(config)) { if (!record.verified || record.manifest.profile !== "knowledge" || record.manifest.createdByMachineId !== identity.machineId) continue; try { await eligibleContext(uuid.parse(conflictId), record.backupId, environment, new Date()); candidates.push(record.backupId); } catch { /* Hidden unless every server precondition holds. */ } } }
  catch { return null; }
  return candidates.length ? { backupIds: candidates } : null;
}

export async function keepCurrentAndReacquireExpiredLocalWriter(
  input: { conflictId: string; backupId: string; confirmationText?: string; idempotencyKey: string }, environment: LibraryEnvironment = process.env,
  options: { now?: Date; wait?: (milliseconds: number) => Promise<void>; lockWait?: (milliseconds: number) => Promise<void>; checkpointId?: string; authorityId?: string; failAt?: "after-baseline" | "after-conflict" | "after-checkpoint"; crashAfter?: "baseline" | "conflict" | "checkpoint" | "authority" } = {},
): Promise<ExpiredLocalConflictReacquireResult> {
  const conflictId = uuid.parse(input.conflictId); const backupId = uuid.parse(input.backupId); const idempotencyKey = uuid.parse(input.idempotencyKey);
  if (input.confirmationText !== "CONSERVER ET REACQUERIR") throw new PortabilityError("EXPIRED_LOCAL_CONFLICT_CONFIRMATION_REQUIRED");
  const requestedAt = options.now || new Date(); const config = getPortabilityConfig(environment); const identity = await loadMachineIdentity(config);
  if (!identity) throw new PortabilityError("PORTABILITY_NOT_CONFIGURED");
  const lock = await acquireWriterOperationLock(config, idempotencyKey, options.lockWait);
  try {
    const prior = await readOptional(operationPath(config, idempotencyKey), operationSchema);
    if (prior && (prior.conflictId !== conflictId || prior.backupId !== backupId || prior.machineId !== identity.machineId)) throw new PortabilityError("IDEMPOTENCY_CONFLICT");
    const replay = prior ? await replayResult(prior, environment) : null;
    if (replay) return replay;
    if (prior) { const library = parseLibraryConfig(environment); if (!library.ok) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT"); await restoreIncompleteOperation(config, library.rootPath, prior); await rm(operationPath(config, idempotencyKey), { force: false }); }
    const current = await eligibleContext(conflictId, backupId, environment, requestedAt, options.wait);
    const checkpointId = uuid.parse(options.checkpointId || randomUUID()); const authorityId = uuid.parse(options.authorityId || randomUUID());
    await assertCheckpointUnused(current.library.rootPath, checkpointId);
    const operation = operationSchema.parse({ schemaVersion: 2, idempotencyKey, conflictId, backupId, machineId: current.identity.machineId, createdAt: requestedAt.toISOString(), expiresAt: new Date(requestedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(), status: "in-progress", rollback: { baseline: current.baseline, authority: current.authority, checkpoint: current.checkpoint, conflicts: current.conflicts, targetSnapshot: current.snapshot, checkpointId, authorityId, phase: "prepared" } });
    await atomicWriteJson(operationPath(current.config, idempotencyKey), operation, true);
    let phase = operation.rollback.phase;
    const advance = async (next: z.infer<typeof rollbackSchema>["phase"]) => { phase = next; await atomicWriteJson(operationPath(current.config, idempotencyKey), operationSchema.parse({ ...operation, rollback: { ...operation.rollback, phase: next } })); };
    try {
      await persistLatestSnapshot(current.config, current.snapshot); await advance("baseline-persisted"); if (options.failAt === "after-baseline") throw new PortabilityError("CONTROLLED_STATE_UPDATE_FAILED"); if (options.crashAfter === "baseline") throw new SimulatedInterruption();
      const checkpoint = await createCheckpoint(current.library.rootPath, current.snapshot, "conflict-resolved", { checkpointId, conflictId, now: requestedAt }); await advance("checkpoint-created"); if (options.failAt === "after-checkpoint") throw new PortabilityError("CONTROLLED_STATE_UPDATE_FAILED"); if (options.crashAfter === "checkpoint") throw new SimulatedInterruption();
      // The conflict deliberately remains open while authority changes, so canWrite stays false until the operation is durably committed.
      const authority = await reacquireWriterAuthority(current.library.rootPath, current.identity, checkpoint, current.config.writerLeaseMinutes, requestedAt, authorityId); await advance("authority-reacquired"); if (options.crashAfter === "authority") throw new SimulatedInterruption();
      const result = resultSchema.parse({ operation: "expired-local-conflict-reacquire", idempotencyKey, conflict: { conflictId, status: "resolved" }, authority, checkpoint }) as ExpiredLocalConflictReacquireResult;
      // Commit the final intent before resolving the blocker. A crash here is replay-finalizable while canWrite remains false.
      await atomicWriteJson(operationPath(current.config, idempotencyKey), operationSchema.parse({ ...operation, status: "success", rollback: { ...operation.rollback, phase }, result }));
      const resolvedConflicts = current.conflicts.map((item) => item.conflictId === conflictId ? { ...item, status: "resolved" as const } : item);
      await atomicWriteJson(conflictPath(current.config), resolvedConflicts); if (options.failAt === "after-conflict") throw new PortabilityError("CONTROLLED_STATE_UPDATE_FAILED"); if (options.crashAfter === "conflict") throw new SimulatedInterruption();
      await appendPortabilityHistoryOnce(current.config.statePath, { schemaVersion: 1, eventId: idempotencyKey, event: "expired-local-conflict-reacquired", timestamp: requestedAt.toISOString(), machineId: current.identity.machineId, relatedId: conflictId, status: "resolved" });
      return result;
    } catch (error) {
      if (error instanceof SimulatedInterruption) throw error;
      if (phase === "authority-reacquired") throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT", { cause: error });
      try { await restoreIncompleteOperation(current.config, current.library.rootPath, operationSchema.parse({ ...operation, rollback: { ...operation.rollback, phase } })); await rm(operationPath(current.config, idempotencyKey), { force: false }); }
      catch (rollbackError) { throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT", { cause: rollbackError }); }
      throw error instanceof PortabilityError ? error : new PortabilityError("CONTROLLED_STATE_UPDATE_FAILED", { cause: error });
    }
  } finally { await lock.release(); }
}
