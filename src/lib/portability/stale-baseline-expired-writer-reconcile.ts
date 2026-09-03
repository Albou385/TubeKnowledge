import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { listBackupRecords, verifyPortabilityBackup } from "./backup-reader";
import { latestCheckpoint } from "./checkpoints";
import { getPortabilityConfig, type PortabilityConfig } from "./config";
import { loadConflicts } from "./conflicts";
import { PortabilityError } from "./errors";
import { atomicWriteJson, windowsPathKey } from "./filesystem";
import { listHandoffs } from "./handoff";
import { appendPortabilityHistoryOnce } from "./history";
import { loadMachineIdentity } from "./machine-identity";
import { inspectPortabilityReadiness } from "./readiness";
import { changedKnowledgePaths, createStableSnapshot, persistLatestSnapshot, readLatestSnapshot } from "./snapshots";
import type { Checkpoint, PortabilityConflict, VaultSnapshot, WriterAuthority } from "./types";
import { isAuthorityActive, reacquireWriterAuthority, readWriterAuthority, writerAuthorityPath } from "./writer-authority";
import { acquireWriterOperationLock } from "./writer-operation-lock";

const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const snapshotSchema = z.object({ schemaVersion: z.literal(1), snapshotId: uuid, createdAt: z.iso.datetime(), machineId: uuid, fileCount: z.number().int().nonnegative(), totalBytes: z.number().int().nonnegative(), rootHash: hash, files: z.array(z.object({ path: z.string().min(1), size: z.number().int().nonnegative(), sha256: hash, modifiedAt: z.iso.datetime() }).strict()) }).strict();
const authoritySchema = z.object({ schemaVersion: z.literal(1), authorityId: uuid, machineId: uuid, displayName: z.string(), grantedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), checkpointId: uuid, status: z.enum(["active", "released"]) }).strict();
const checkpointSchema = z.object({ schemaVersion: z.literal(1), checkpointId: uuid, rootHash: hash, machineId: uuid, action: z.enum(["import", "restore", "conflict-resolved", "handoff", "backup"]), createdAt: z.iso.datetime(), importId: uuid.optional(), restoreId: uuid.optional(), conflictId: uuid.optional(), backupId: uuid.optional() }).strict();
const conflictSchema = z.object({ schemaVersion: z.literal(1), conflictId: uuid, type: z.enum(["content-divergence", "case-collision", "duplicate-suspected", "onedrive-conflict-copy", "deleted-vs-modified", "checkpoint-mismatch", "unexpected-system-change", "stale-writer-authority", "incomplete-placeholder"]), detectedAt: z.iso.datetime(), paths: z.array(z.string()), baseCheckpointId: uuid.optional(), severity: z.enum(["warning", "blocking"]), status: z.enum(["open", "resolved", "false-positive"]), evidence: z.object({ hashes: z.array(hash).optional(), sizes: z.array(z.number()).optional(), dates: z.array(z.string()).optional(), reason: z.string() }).strict() }).strict();
const operationSchema = z.object({
  schemaVersion: z.literal(1), idempotencyKey: uuid, conflictId: uuid, backupId: uuid, machineId: uuid,
  createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(), status: z.enum(["in-progress", "success"]),
  rollback: z.object({ baseline: snapshotSchema, authority: authoritySchema, conflicts: z.array(conflictSchema), targetSnapshot: snapshotSchema, checkpoint: checkpointSchema, authorityId: uuid }).strict(),
  result: z.object({ operation: z.literal("stale-baseline-expired-writer-reconcile"), idempotencyKey: uuid, resolvedConflictIds: z.array(uuid).min(1), authority: authoritySchema, checkpoint: checkpointSchema }).strict().optional(),
}).strict();

export interface StaleBaselineReconcileResult { operation: "stale-baseline-expired-writer-reconcile"; idempotencyKey: string; resolvedConflictIds: string[]; authority: WriterAuthority; checkpoint: Checkpoint; }
export const staleBaselineReconcileRequestSchema = z.object({ backupId: uuid, confirmationText: z.literal("RECONCILIER ET REACQUERIR") }).strict();
class SimulatedInterruption extends Error {}

function operationPath(config: PortabilityConfig, idempotencyKey: string) { return path.join(config.statePath, "stale-baseline-expired-writer-reconcile", "operations", `${uuid.parse(idempotencyKey)}.json`); }
function conflictsPath(config: PortabilityConfig) { return path.join(config.statePath, "conflicts.json"); }
async function readOperation(config: PortabilityConfig, idempotencyKey: string) {
  try { return operationSchema.parse(JSON.parse(await readFile(operationPath(config, idempotencyKey), "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT", { cause: error }); }
}

function conflictCompatibleWithStaleBaseline(conflict: PortabilityConflict, changedPaths: Set<string>) {
  return conflict.type === "content-divergence" && conflict.severity === "blocking" && conflict.status === "open" && conflict.paths.length > 0 && conflict.paths.every((item) => changedPaths.has(windowsPathKey(item)));
}

async function eligibleContext(conflictId: string, backupId: string, environment: LibraryEnvironment, now: Date, wait?: (milliseconds: number) => Promise<void>) {
  const config = getPortabilityConfig(environment); const library = parseLibraryConfig(environment); const identity = await loadMachineIdentity(config);
  if (!config.enabled || !library.ok || !identity) throw new PortabilityError("PORTABILITY_NOT_CONFIGURED");
  const readiness = await inspectPortabilityReadiness(library.rootPath, config, identity, environment, now);
  if (readiness.status === "offline-placeholder") throw new PortabilityError("PLACEHOLDER_DETECTED");
  if (readiness.status !== "ready-local") throw new PortabilityError("VAULT_UNAVAILABLE");
  const [authority, baseline, checkpoint, conflicts, handoffs] = await Promise.all([readWriterAuthority(library.rootPath), readLatestSnapshot(config), latestCheckpoint(library.rootPath), loadConflicts(config), listHandoffs(library.rootPath)]);
  if (!authority || authority.status !== "active" || isAuthorityActive(authority, now) || authority.machineId !== identity.machineId) throw new PortabilityError("STALE_BASELINE_RECONCILE_NOT_ALLOWED");
  if (!baseline || !checkpoint || baseline.rootHash === checkpoint.rootHash || authority.checkpointId !== checkpoint.checkpointId) throw new PortabilityError("STALE_BASELINE_RECONCILE_NOT_ALLOWED");
  if (handoffs.some((item) => ["prepared", "accepted"].includes(item.status) && new Date(item.expiresAt).getTime() > now.getTime())) throw new PortabilityError("WRITER_REACQUIRE_BLOCKED_BY_HANDOFF");
  let snapshot: VaultSnapshot;
  try { snapshot = await createStableSnapshot(library.rootPath, identity.machineId, config.stabilityWindowSeconds, { now, wait }); }
  catch (error) { if (error instanceof PortabilityError) throw error; if (error instanceof Error && error.message === "VAULT_UNSTABLE") throw new PortabilityError("VAULT_UNSTABLE"); throw new PortabilityError("VAULT_UNAVAILABLE"); }
  if (snapshot.rootHash !== checkpoint.rootHash) throw new PortabilityError("STALE_BASELINE_RECONCILE_NOT_ALLOWED");
  const changedPaths = new Set(changedKnowledgePaths(baseline, snapshot).map(windowsPathKey));
  const staleConflicts = conflicts.filter((item) => item.status === "open");
  if (!staleConflicts.length || !staleConflicts.some((item) => item.conflictId === conflictId) || !staleConflicts.every((item) => conflictCompatibleWithStaleBaseline(item, changedPaths))) throw new PortabilityError("STALE_BASELINE_RECONCILE_NOT_ALLOWED");
  let backup; try { backup = await verifyPortabilityBackup(config, backupId); } catch { throw new PortabilityError("BACKUP_SNAPSHOT_MISMATCH"); }
  if (!backup.record.verified || backup.record.manifest.profile !== "knowledge" || backup.record.manifest.createdByMachineId !== identity.machineId || backup.record.manifest.sourceRootHash !== snapshot.rootHash) throw new PortabilityError("BACKUP_SNAPSHOT_MISMATCH");
  return { config, library, identity, authority, baseline, checkpoint, conflicts, snapshot, resolvedConflictIds: staleConflicts.map((item) => item.conflictId) };
}

async function rollback(config: PortabilityConfig, vaultPath: string, operation: z.infer<typeof operationSchema>) {
  const [authority, baseline, conflicts] = await Promise.all([readWriterAuthority(vaultPath), readLatestSnapshot(config), loadConflicts(config)]);
  const knownAuthority = JSON.stringify(authority) === JSON.stringify(operation.rollback.authority) || (authority?.authorityId === operation.rollback.authorityId && authority.machineId === operation.machineId && authority.checkpointId === operation.rollback.checkpoint.checkpointId && authority.status === "active");
  const knownBaseline = JSON.stringify(baseline) === JSON.stringify(operation.rollback.baseline) || JSON.stringify(baseline) === JSON.stringify(operation.rollback.targetSnapshot);
  const resolvedConflicts = operation.rollback.conflicts.map((item) => item.type === "content-divergence" && item.status === "open" ? { ...item, status: "resolved" } : item);
  const knownConflicts = JSON.stringify(conflicts) === JSON.stringify(operation.rollback.conflicts) || JSON.stringify(conflicts) === JSON.stringify(resolvedConflicts);
  if (!knownAuthority || !knownBaseline || !knownConflicts) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
  await atomicWriteJson(writerAuthorityPath(vaultPath), operation.rollback.authority);
  await persistLatestSnapshot(config, operation.rollback.baseline);
  await atomicWriteJson(conflictsPath(config), operation.rollback.conflicts);
}

async function replay(operation: z.infer<typeof operationSchema>, environment: LibraryEnvironment): Promise<StaleBaselineReconcileResult | null> {
  if (operation.status !== "success" || !operation.result) return null;
  const result = operation.result as StaleBaselineReconcileResult; const config = getPortabilityConfig(environment); const library = parseLibraryConfig(environment);
  if (!library.ok) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
  const [baseline, authority, checkpoint, conflicts] = await Promise.all([readLatestSnapshot(config), readWriterAuthority(library.rootPath), latestCheckpoint(library.rootPath), loadConflicts(config)]);
  if (baseline?.rootHash !== result.checkpoint.rootHash || checkpoint?.checkpointId !== result.checkpoint.checkpointId || authority?.authorityId !== result.authority.authorityId || authority.checkpointId !== result.checkpoint.checkpointId) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
  const unresolved = result.resolvedConflictIds.filter((id) => conflicts.find((item) => item.conflictId === id)?.status === "open");
  if (unresolved.length) {
    if (unresolved.some((id) => JSON.stringify(conflicts.find((item) => item.conflictId === id)) !== JSON.stringify(operation.rollback.conflicts.find((item) => item.conflictId === id)))) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
    await atomicWriteJson(conflictsPath(config), conflicts.map((item) => unresolved.includes(item.conflictId) ? { ...item, status: "resolved" } : item));
  }
  if (result.resolvedConflictIds.some((id) => (unresolved.includes(id) ? false : conflicts.find((item) => item.conflictId === id)?.status !== "resolved"))) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
  await appendPortabilityHistoryOnce(config.statePath, { schemaVersion: 1, eventId: operation.idempotencyKey, event: "stale-baseline-reconciled", timestamp: operation.createdAt, machineId: operation.machineId, relatedId: operation.conflictId, status: "reconciled" });
  return result;
}

export async function canOfferStaleBaselineReconcile(conflictId: string, environment: LibraryEnvironment = process.env): Promise<{ backupIds: string[] } | null> {
  const config = getPortabilityConfig(environment); const identity = await loadMachineIdentity(config); if (!identity) return null;
  const backupIds: string[] = [];
  try { for (const record of await listBackupRecords(config)) { if (!record.verified || record.manifest.profile !== "knowledge" || record.manifest.createdByMachineId !== identity.machineId) continue; try { await eligibleContext(uuid.parse(conflictId), record.backupId, environment, new Date()); backupIds.push(record.backupId); } catch { /* The UI must remain hidden until all server evidence succeeds. */ } } } catch { return null; }
  return backupIds.length ? { backupIds } : null;
}

export async function reconcileStaleBaselineAndReacquireWriter(input: { conflictId: string; backupId: string; confirmationText?: string; idempotencyKey: string }, environment: LibraryEnvironment = process.env, options: { now?: Date; wait?: (milliseconds: number) => Promise<void>; lockWait?: (milliseconds: number) => Promise<void>; authorityId?: string; crashAfter?: "baseline" | "authority" | "conflicts" } = {}): Promise<StaleBaselineReconcileResult> {
  const conflictId = uuid.parse(input.conflictId); const backupId = uuid.parse(input.backupId); const idempotencyKey = uuid.parse(input.idempotencyKey);
  if (input.confirmationText !== "RECONCILIER ET REACQUERIR") throw new PortabilityError("STALE_BASELINE_RECONCILE_CONFIRMATION_REQUIRED");
  const requestedAt = options.now || new Date(); const config = getPortabilityConfig(environment); const identity = await loadMachineIdentity(config);
  if (!identity) throw new PortabilityError("PORTABILITY_NOT_CONFIGURED");
  const lock = await acquireWriterOperationLock(config, idempotencyKey, options.lockWait);
  try {
    const prior = await readOperation(config, idempotencyKey);
    if (prior && (prior.conflictId !== conflictId || prior.backupId !== backupId || prior.machineId !== identity.machineId)) throw new PortabilityError("IDEMPOTENCY_CONFLICT");
    const replayed = prior ? await replay(prior, environment) : null; if (replayed) return replayed;
    if (prior) { const library = parseLibraryConfig(environment); if (!library.ok) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT"); await rollback(config, library.rootPath, prior); await rm(operationPath(config, idempotencyKey), { force: false }); }
    const current = await eligibleContext(conflictId, backupId, environment, requestedAt, options.wait);
    const authorityId = uuid.parse(options.authorityId || randomUUID());
    const operation = operationSchema.parse({ schemaVersion: 1, idempotencyKey, conflictId, backupId, machineId: current.identity.machineId, createdAt: requestedAt.toISOString(), expiresAt: new Date(requestedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(), status: "in-progress", rollback: { baseline: current.baseline, authority: current.authority, conflicts: current.conflicts, targetSnapshot: current.snapshot, checkpoint: current.checkpoint, authorityId } });
    await atomicWriteJson(operationPath(config, idempotencyKey), operation, true);
    try {
      await persistLatestSnapshot(config, current.snapshot); if (options.crashAfter === "baseline") throw new SimulatedInterruption();
      const authority = await reacquireWriterAuthority(current.library.rootPath, current.identity, current.checkpoint, current.config.writerLeaseMinutes, requestedAt, authorityId); if (options.crashAfter === "authority") throw new SimulatedInterruption();
      if (options.crashAfter === "conflicts") throw new SimulatedInterruption();
      const result: StaleBaselineReconcileResult = { operation: "stale-baseline-expired-writer-reconcile", idempotencyKey, resolvedConflictIds: current.resolvedConflictIds, authority, checkpoint: current.checkpoint };
      await atomicWriteJson(operationPath(config, idempotencyKey), operationSchema.parse({ ...operation, status: "success", result }));
      // Keep the blocker open until the durable operation result exists; any interruption remains fail-closed.
      const resolved = current.conflicts.map((item) => current.resolvedConflictIds.includes(item.conflictId) ? { ...item, status: "resolved" as const } : item);
      await atomicWriteJson(conflictsPath(config), resolved);
      await appendPortabilityHistoryOnce(config.statePath, { schemaVersion: 1, eventId: idempotencyKey, event: "stale-baseline-reconciled", timestamp: requestedAt.toISOString(), machineId: current.identity.machineId, relatedId: conflictId, status: "reconciled" });
      return result;
    } catch (error) {
      if (error instanceof SimulatedInterruption) throw error;
      await rollback(config, current.library.rootPath, operation); await rm(operationPath(config, idempotencyKey), { force: false }); throw error;
    }
  } finally { await lock.release(); }
}
