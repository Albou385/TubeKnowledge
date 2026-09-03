import { randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { verifyPortabilityBackup } from "./backup-reader";
import { checkpointDirectory, createCheckpoint, latestCheckpoint, readCheckpoint } from "./checkpoints";
import { getPortabilityConfig, type PortabilityConfig } from "./config";
import { PORTABILITY_LIMITS } from "./constants";
import { loadConflicts } from "./conflicts";
import { PortabilityError } from "./errors";
import { atomicWriteJson } from "./filesystem";
import { appendPortabilityHistoryOnce } from "./history";
import { loadMachineIdentity } from "./machine-identity";
import { inspectPortabilityReadiness } from "./readiness";
import { createStableSnapshot } from "./snapshots";
import type { Checkpoint, MachineIdentity, WriterAuthority } from "./types";
import { acquireWriterAuthority, isAuthorityActive, readWriterAuthority, writerAuthorityPath } from "./writer-authority";
import { acquireWriterOperationLock } from "./writer-operation-lock";

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
const resultSchema = z.object({
  outcome: z.enum(["created", "already-active"]), idempotencyKey: uuid,
  checkpoint: checkpointSchema, authority: authoritySchema,
}).strict();
const recordSchema = z.object({
  schemaVersion: z.literal(1), idempotencyKey: uuid, machineId: uuid, backupId: uuid,
  rootHash: hash.optional(), createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  status: z.enum(["in-progress", "success", "failed"]), checkpointId: uuid.optional(),
  authorityId: uuid.optional(), eventId: uuid.optional(), previousAuthority: authoritySchema.nullable().optional(),
  result: resultSchema.optional(), failureCode: z.string().max(80).optional(),
}).strict();

export interface WriterBootstrapInput {
  idempotencyKey: string;
  backupId: string;
  confirmationText: "REPRENDRE";
}

export interface WriterBootstrapResult {
  outcome: "created" | "already-active";
  idempotencyKey: string;
  checkpoint: Checkpoint;
  authority: WriterAuthority;
}

interface BootstrapRecord {
  schemaVersion: 1;
  idempotencyKey: string;
  machineId: string;
  backupId: string;
  rootHash?: string;
  createdAt: string;
  expiresAt: string;
  status: "in-progress" | "success" | "failed";
  checkpointId?: string;
  authorityId?: string;
  eventId?: string;
  previousAuthority?: WriterAuthority | null;
  result?: WriterBootstrapResult;
  failureCode?: string;
}

export interface BootstrapWriterOptions {
  now?: Date;
  wait?: (milliseconds: number) => Promise<void>;
  lockWait?: (milliseconds: number) => Promise<void>;
  failAfterStage?: "checkpoint" | "authority";
}

function registryDirectory(config: PortabilityConfig): string {
  return path.join(config.statePath, "writer-bootstrap-idempotency");
}

function recordPath(config: PortabilityConfig, idempotencyKey: string): string {
  return path.join(registryDirectory(config), `${uuid.parse(idempotencyKey)}.json`);
}

async function readRecord(config: PortabilityConfig, idempotencyKey: string): Promise<BootstrapRecord | null> {
  try {
    return recordSchema.parse(JSON.parse(await readFile(recordPath(config, idempotencyKey), "utf8"))) as BootstrapRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeRecord(config: PortabilityConfig, record: BootstrapRecord): Promise<void> {
  await atomicWriteJson(recordPath(config, record.idempotencyKey), recordSchema.parse(record));
}

async function restorePreviousAuthority(vaultPath: string, previous: WriterAuthority | null | undefined): Promise<void> {
  if (previous) await atomicWriteJson(writerAuthorityPath(vaultPath), authoritySchema.parse(previous));
  else await rm(writerAuthorityPath(vaultPath), { force: true });
}

async function rollbackRecord(vaultPath: string, config: PortabilityConfig, record: BootstrapRecord): Promise<void> {
  const authority = await readWriterAuthority(vaultPath);
  if (authority?.authorityId === record.authorityId) await restorePreviousAuthority(vaultPath, record.previousAuthority);
  if (record.checkpointId) {
    try {
      const checkpoint = await readCheckpoint(vaultPath, record.checkpointId);
      if (checkpoint.checkpointId === record.checkpointId) {
        await rm(path.join(checkpointDirectory(vaultPath), `${record.checkpointId}.json`), { force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  await writeRecord(config, { ...record, status: "failed", failureCode: "INCOMPLETE_BOOTSTRAP_ROLLED_BACK" });
}

async function completeRecord(config: PortabilityConfig, record: BootstrapRecord, checkpoint: Checkpoint, authority: WriterAuthority): Promise<WriterBootstrapResult> {
  const result = resultSchema.parse({ outcome: "created", idempotencyKey: record.idempotencyKey, checkpoint, authority }) as WriterBootstrapResult;
  await appendPortabilityHistoryOnce(config.statePath, {
    schemaVersion: 1,
    eventId: record.eventId!,
    event: "writer-bootstrap",
    timestamp: checkpoint.createdAt,
    machineId: record.machineId,
    relatedId: checkpoint.checkpointId,
    status: "created",
  });
  try {
    await writeRecord(config, { ...record, status: "success", result });
  } catch {
    // Le checkpoint, l'autorité et l'événement forment déjà un état cohérent.
    // Le journal in-progress permettra la récupération au prochain appel.
  }
  return result;
}

async function recoverIncompleteRecords(vaultPath: string, config: PortabilityConfig): Promise<void> {
  let names: string[];
  try {
    names = (await readdir(registryDirectory(config))).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const name of names) {
    const record = recordSchema.parse(JSON.parse(await readFile(path.join(registryDirectory(config), name), "utf8"))) as BootstrapRecord;
    if (record.status !== "in-progress" || !record.checkpointId || !record.authorityId || !record.eventId) continue;
    let checkpoint: Checkpoint | null = null;
    try {
      checkpoint = await readCheckpoint(vaultPath, record.checkpointId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const authority = await readWriterAuthority(vaultPath);
    if (checkpoint && authority?.authorityId === record.authorityId && authority.checkpointId === checkpoint.checkpointId) {
      await completeRecord(config, record, checkpoint, authority);
    } else {
      await rollbackRecord(vaultPath, config, record);
    }
  }
}

function assertRecordMatches(record: BootstrapRecord, identity: MachineIdentity, backupId: string, now: Date): void {
  if (record.machineId !== identity.machineId || record.backupId !== backupId) throw new PortabilityError("IDEMPOTENCY_CONFLICT");
  if (new Date(record.expiresAt).getTime() <= now.getTime()) throw new PortabilityError("IDEMPOTENCY_KEY_INVALID");
}

export async function bootstrapWriter(input: WriterBootstrapInput, environment: LibraryEnvironment = process.env, options: BootstrapWriterOptions = {}): Promise<WriterBootstrapResult> {
  const idempotencyKey = uuid.parse(input.idempotencyKey);
  const backupId = uuid.parse(input.backupId);
  if (input.confirmationText !== "REPRENDRE") throw new PortabilityError("BACKUP_REQUIRED");
  const config = getPortabilityConfig(environment);
  const library = parseLibraryConfig(environment);
  const identity = await loadMachineIdentity(config);
  if (!config.enabled || !library.ok || !identity) throw new PortabilityError("PORTABILITY_NOT_CONFIGURED");
  const now = options.now || new Date();
  const lock = await acquireWriterOperationLock(config, idempotencyKey, options.lockWait);
  try {
    await recoverIncompleteRecords(library.rootPath, config);
    const existingRecord = await readRecord(config, idempotencyKey);
    if (existingRecord) {
      assertRecordMatches(existingRecord, identity, backupId, now);
      if (existingRecord.status === "success" && existingRecord.result) return resultSchema.parse(existingRecord.result) as WriterBootstrapResult;
    }
    const currentAuthority = await readWriterAuthority(library.rootPath);
    if (currentAuthority && isAuthorityActive(currentAuthority, now) && currentAuthority.machineId !== identity.machineId) {
      throw new PortabilityError("WRITER_ACTIVE_ELSEWHERE");
    }
    if (currentAuthority || await latestCheckpoint(library.rootPath)) {
      throw new PortabilityError("WRITER_ALREADY_INITIALIZED");
    }

    const readiness = await inspectPortabilityReadiness(library.rootPath, config, identity, environment, now);
    if (readiness.status === "writer-active-elsewhere") throw new PortabilityError("WRITER_ACTIVE_ELSEWHERE");
    if (readiness.status === "offline-placeholder") throw new PortabilityError("PLACEHOLDER_DETECTED");
    if (readiness.status !== "ready-local") throw new PortabilityError("VAULT_UNAVAILABLE");

    let backup;
    try {
      backup = await verifyPortabilityBackup(config, backupId);
    } catch {
      throw new PortabilityError("BACKUP_INVALID");
    }
    if (backup.record.manifest.createdByMachineId !== identity.machineId) throw new PortabilityError("BACKUP_INVALID");

    let snapshot;
    try {
      snapshot = await createStableSnapshot(library.rootPath, identity.machineId, config.stabilityWindowSeconds, { now, wait: options.wait });
    } catch (error) {
      if (error instanceof PortabilityError) throw error;
      if (error instanceof Error && error.message === "VAULT_UNSTABLE") throw new PortabilityError("VAULT_UNSTABLE");
      throw new PortabilityError("VAULT_UNAVAILABLE");
    }
    if (backup.record.manifest.sourceRootHash !== snapshot.rootHash) throw new PortabilityError("BACKUP_SNAPSHOT_MISMATCH");
    const conflicts = await loadConflicts(config);
    if (conflicts.some((item) => item.status === "open" && item.severity === "blocking")) throw new PortabilityError("CONFLICTS_BLOCKING");

    const record: BootstrapRecord = {
      schemaVersion: 1,
      idempotencyKey,
      machineId: identity.machineId,
      backupId,
      rootHash: snapshot.rootHash,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PORTABILITY_LIMITS.writerBootstrapIdempotencyTtlMs).toISOString(),
      status: "in-progress",
      checkpointId: randomUUID(),
      authorityId: randomUUID(),
      eventId: randomUUID(),
      previousAuthority: currentAuthority,
    };
    await writeRecord(config, record);
    let checkpoint: Checkpoint;
    try {
      checkpoint = await createCheckpoint(library.rootPath, snapshot, "backup", { now, checkpointId: record.checkpointId, backupId });
    } catch (error) {
      await writeRecord(config, { ...record, status: "failed", failureCode: "CHECKPOINT_CREATION_FAILED" });
      throw new PortabilityError("CHECKPOINT_CREATION_FAILED", { cause: error });
    }
    try {
      if (options.failAfterStage === "checkpoint") throw new Error("Injected failure after checkpoint");
      const authority = await acquireWriterAuthority(library.rootPath, identity, checkpoint, config.writerLeaseMinutes, {
        now, force: true, verifiedBackupId: backupId, confirmationText: input.confirmationText, authorityId: record.authorityId,
      });
      if (options.failAfterStage === "authority") throw new Error("Injected failure after authority");
      return await completeRecord(config, record, checkpoint, authority);
    } catch (error) {
      await rollbackRecord(library.rootPath, config, record);
      if (error instanceof PortabilityError) throw error;
      throw new PortabilityError("WRITER_ACQUISITION_FAILED", { cause: error });
    }
  } finally {
    await lock.release();
  }
}
