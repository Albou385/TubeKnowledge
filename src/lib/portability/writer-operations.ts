import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { verifyPortabilityBackup } from "./backup-reader";
import { createCheckpoint, latestCheckpoint } from "./checkpoints";
import { getPortabilityConfig } from "./config";
import { PORTABILITY_LIMITS } from "./constants";
import { isBlockingKnowledgeConflict, loadConflicts } from "./conflicts";
import { PortabilityError } from "./errors";
import { atomicWriteJson } from "./filesystem";
import { listHandoffs } from "./handoff";
import { appendPortabilityHistoryOnce } from "./history";
import { loadMachineIdentity } from "./machine-identity";
import { inspectPortabilityReadiness } from "./readiness";
import { createStableSnapshot } from "./snapshots";
import type { Checkpoint, WriterAuthority } from "./types";
import { isAuthorityActive, reacquireWriterAuthority, readWriterAuthority, renewWriterAuthority } from "./writer-authority";
import { acquireWriterOperationLock } from "./writer-operation-lock";

const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const authoritySchema = z.object({
  schemaVersion: z.literal(1), authorityId: uuid, machineId: uuid, displayName: z.string(),
  grantedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), checkpointId: uuid, status: z.enum(["active", "released"]),
}).strict();
const checkpointSchema = z.object({
  schemaVersion: z.literal(1), checkpointId: uuid, rootHash: hash, machineId: uuid,
  action: z.enum(["import", "restore", "conflict-resolved", "handoff", "backup"]), createdAt: z.iso.datetime(),
  importId: uuid.optional(), restoreId: uuid.optional(), conflictId: uuid.optional(), backupId: uuid.optional(),
}).strict();
const resultSchema = z.object({
  operation: z.enum(["renew", "reacquire"]),
  idempotencyKey: uuid,
  authority: authoritySchema,
  checkpoint: checkpointSchema,
  checkpointCreated: z.boolean(),
}).strict();
const recordSchema = z.object({
  schemaVersion: z.literal(1),
  idempotencyKey: uuid,
  operation: z.enum(["renew", "reacquire"]),
  machineId: uuid,
  backupId: uuid.optional(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  status: z.enum(["in-progress", "success"]),
  result: resultSchema.optional(),
}).strict();

export interface WriterOperationResult {
  operation: "renew" | "reacquire";
  idempotencyKey: string;
  authority: WriterAuthority;
  checkpoint: Checkpoint;
  checkpointCreated: boolean;
}

export interface WriterOperationOptions {
  now?: Date;
  wait?: (milliseconds: number) => Promise<void>;
  lockWait?: (milliseconds: number) => Promise<void>;
}

function recordPath(statePath: string, idempotencyKey: string): string {
  return path.join(statePath, "writer-operations-idempotency", `${uuid.parse(idempotencyKey)}.json`);
}

async function readRecord(statePath: string, idempotencyKey: string): Promise<z.infer<typeof recordSchema> | null> {
  try {
    return recordSchema.parse(JSON.parse(await readFile(recordPath(statePath, idempotencyKey), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeRecord(statePath: string, record: z.infer<typeof recordSchema>): Promise<void> {
  await atomicWriteJson(recordPath(statePath, record.idempotencyKey), recordSchema.parse(record));
}

async function context(environment: LibraryEnvironment, now: Date, wait?: (milliseconds: number) => Promise<void>, blockingCode: "PORTABILITY_CONFLICT_BLOCKING" | "WRITER_REACQUIRE_BLOCKED_BY_CONFLICT" = "PORTABILITY_CONFLICT_BLOCKING") {
  const config = getPortabilityConfig(environment);
  const library = parseLibraryConfig(environment);
  const identity = await loadMachineIdentity(config);
  if (!config.enabled || !library.ok || !identity) throw new PortabilityError("PORTABILITY_NOT_CONFIGURED");
  const readiness = await inspectPortabilityReadiness(library.rootPath, config, identity, environment, now);
  if (readiness.status === "offline-placeholder") throw new PortabilityError("PLACEHOLDER_DETECTED");
  if (readiness.status !== "ready-local") throw new PortabilityError("VAULT_UNAVAILABLE");
  if ((await loadConflicts(config)).some(isBlockingKnowledgeConflict)) throw new PortabilityError(blockingCode);
  let snapshot;
  try {
    snapshot = await createStableSnapshot(library.rootPath, identity.machineId, config.stabilityWindowSeconds, { now, wait });
  } catch (error) {
    if (error instanceof PortabilityError) throw error;
    if (error instanceof Error && error.message === "VAULT_UNSTABLE") throw new PortabilityError("VAULT_UNSTABLE");
    throw new PortabilityError("VAULT_UNAVAILABLE");
  }
  return { config, library, identity, snapshot };
}

function assertReplay(record: z.infer<typeof recordSchema>, operation: "renew" | "reacquire", machineId: string, backupId: string | undefined, now: Date): void {
  if (record.operation !== operation || record.machineId !== machineId || record.backupId !== backupId) throw new PortabilityError("IDEMPOTENCY_CONFLICT");
  if (new Date(record.expiresAt).getTime() <= now.getTime()) throw new PortabilityError("IDEMPOTENCY_KEY_INVALID");
}

export async function renewWriter(idempotencyKeyInput: string, environment: LibraryEnvironment = process.env, options: WriterOperationOptions = {}): Promise<WriterOperationResult> {
  const idempotencyKey = uuid.parse(idempotencyKeyInput);
  const requestedAt = options.now || new Date();
  const config = getPortabilityConfig(environment);
  const identity = await loadMachineIdentity(config);
  if (!identity) throw new PortabilityError("PORTABILITY_NOT_CONFIGURED");
  const lock = await acquireWriterOperationLock(config, idempotencyKey, options.lockWait);
  try {
    const prior = await readRecord(config.statePath, idempotencyKey);
    if (prior) {
      assertReplay(prior, "renew", identity.machineId, undefined, requestedAt);
      if (prior.status === "success" && prior.result) return resultSchema.parse(prior.result) as WriterOperationResult;
    }
    const createdAt = prior ? new Date(prior.createdAt) : requestedAt;
    const current = await context(environment, createdAt, options.wait);
    const checkpoint = await latestCheckpoint(current.library.rootPath);
    const authority = await readWriterAuthority(current.library.rootPath);
    if (!checkpoint || !authority || authority.checkpointId !== checkpoint.checkpointId || current.snapshot.rootHash !== checkpoint.rootHash) throw new PortabilityError("CHECKPOINT_MISMATCH");
    if (!isAuthorityActive(authority, createdAt) || authority.machineId !== current.identity.machineId) throw new PortabilityError("WRITER_RENEWAL_NOT_ALLOWED");
    const record = prior || recordSchema.parse({
      schemaVersion: 1, idempotencyKey, operation: "renew", machineId: current.identity.machineId,
      createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + PORTABILITY_LIMITS.writerOperationIdempotencyTtlMs).toISOString(),
      status: "in-progress",
    });
    if (!prior) await writeRecord(config.statePath, record);
    const renewed = await renewWriterAuthority(current.library.rootPath, current.identity, config.writerLeaseMinutes, createdAt);
    const result = resultSchema.parse({ operation: "renew", idempotencyKey, authority: renewed, checkpoint, checkpointCreated: false }) as WriterOperationResult;
    await appendPortabilityHistoryOnce(config.statePath, { schemaVersion: 1, eventId: idempotencyKey, event: "writer-renewed", timestamp: createdAt.toISOString(), machineId: identity.machineId, relatedId: renewed.authorityId, status: "renewed" });
    await writeRecord(config.statePath, { ...record, status: "success", result });
    return result;
  } finally {
    await lock.release();
  }
}

export async function reacquireWriter(input: { idempotencyKey: string; backupId?: string; confirmationText?: string }, environment: LibraryEnvironment = process.env, options: WriterOperationOptions = {}): Promise<WriterOperationResult> {
  const idempotencyKey = uuid.parse(input.idempotencyKey);
  if (!input.backupId) throw new PortabilityError("WRITER_REACQUIRE_BACKUP_REQUIRED");
  const backupId = uuid.parse(input.backupId);
  if (input.confirmationText !== "REACQUERIR") throw new PortabilityError("WRITER_REACQUIRE_CONFIRMATION_REQUIRED");
  const requestedAt = options.now || new Date();
  const config = getPortabilityConfig(environment);
  const identity = await loadMachineIdentity(config);
  if (!identity) throw new PortabilityError("PORTABILITY_NOT_CONFIGURED");
  const library = parseLibraryConfig(environment);
  if (!library.ok) throw new PortabilityError("PORTABILITY_NOT_CONFIGURED");
  const lock = await acquireWriterOperationLock(config, idempotencyKey, options.lockWait);
  try {
    const prior = await readRecord(config.statePath, idempotencyKey);
    if (prior) {
      assertReplay(prior, "reacquire", identity.machineId, backupId, requestedAt);
      if (prior.status === "success" && prior.result) return resultSchema.parse(prior.result) as WriterOperationResult;
    }
    const createdAt = prior ? new Date(prior.createdAt) : requestedAt;
    const currentAuthority = await readWriterAuthority(library.rootPath);
    if (prior?.status === "in-progress" && currentAuthority?.authorityId === idempotencyKey) {
      const checkpoint = await latestCheckpoint(library.rootPath);
      if (!checkpoint) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
      const result = resultSchema.parse({ operation: "reacquire", idempotencyKey, authority: currentAuthority, checkpoint, checkpointCreated: false }) as WriterOperationResult;
      await appendPortabilityHistoryOnce(config.statePath, { schemaVersion: 1, eventId: idempotencyKey, event: "writer-reacquired", timestamp: createdAt.toISOString(), machineId: identity.machineId, relatedId: currentAuthority.authorityId, status: "reacquired" });
      await writeRecord(config.statePath, { ...prior, status: "success", result });
      return result;
    }
    const current = await context(environment, createdAt, options.wait, "WRITER_REACQUIRE_BLOCKED_BY_CONFLICT");
    const authority = await readWriterAuthority(current.library.rootPath);
    if (!authority) throw new PortabilityError("WRITER_UNINITIALIZED");
    if (authority.status !== "active") throw new PortabilityError("WRITER_REACQUIRE_BLOCKED_BY_HANDOFF");
    if (isAuthorityActive(authority, createdAt)) throw new PortabilityError(authority.machineId === identity.machineId ? "WRITER_ACTIVE_LOCAL" : "WRITER_ACTIVE_REMOTE");
    if (authority.machineId !== identity.machineId) throw new PortabilityError("WRITER_EXPIRED_REMOTE");
    const pendingHandoff = (await listHandoffs(current.library.rootPath)).some((item) => item.status === "prepared" && new Date(item.expiresAt).getTime() > createdAt.getTime());
    if (pendingHandoff) throw new PortabilityError("WRITER_REACQUIRE_BLOCKED_BY_HANDOFF");
    let backup;
    try {
      backup = await verifyPortabilityBackup(config, backupId);
    } catch {
      throw new PortabilityError("WRITER_REACQUIRE_BACKUP_REQUIRED");
    }
    if (!backup.record.verified || backup.record.manifest.createdByMachineId !== identity.machineId || backup.record.manifest.sourceRootHash !== current.snapshot.rootHash) throw new PortabilityError("BACKUP_SNAPSHOT_MISMATCH");
    let checkpoint = await latestCheckpoint(current.library.rootPath);
    let checkpointCreated = false;
    if (checkpoint && checkpoint.rootHash !== current.snapshot.rootHash) throw new PortabilityError("CHECKPOINT_MISMATCH");
    if (!checkpoint) {
      checkpoint = await createCheckpoint(current.library.rootPath, current.snapshot, "backup", { now: createdAt, backupId });
      checkpointCreated = true;
    }
    const record = recordSchema.parse({
      schemaVersion: 1, idempotencyKey, operation: "reacquire", machineId: identity.machineId, backupId,
      createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + PORTABILITY_LIMITS.writerOperationIdempotencyTtlMs).toISOString(),
      status: "in-progress",
    });
    if (!prior) await writeRecord(config.statePath, record);
    const reacquired = await reacquireWriterAuthority(current.library.rootPath, identity, checkpoint, config.writerLeaseMinutes, createdAt, idempotencyKey);
    const result = resultSchema.parse({ operation: "reacquire", idempotencyKey, authority: reacquired, checkpoint, checkpointCreated }) as WriterOperationResult;
    await appendPortabilityHistoryOnce(config.statePath, { schemaVersion: 1, eventId: idempotencyKey, event: "writer-reacquired", timestamp: createdAt.toISOString(), machineId: identity.machineId, relatedId: reacquired.authorityId, status: "reacquired" });
    await writeRecord(config.statePath, { ...record, status: "success", result });
    return result;
  } finally {
    await lock.release();
  }
}
