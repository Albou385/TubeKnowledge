import { randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { PortabilityConfig } from "./config";
import { PORTABILITY_LIMITS, PORTABILITY_METADATA_PATH } from "./constants";
import { PortabilityError } from "./errors";
import { atomicWriteJson } from "./filesystem";
import type { BackupRecord, Checkpoint, MachineIdentity, VaultSnapshot, WriterAuthority } from "./types";
import { acquireWriterAuthority, isAuthorityActive, readWriterAuthority, releaseWriterAuthority, writerAuthorityPath } from "./writer-authority";
import { acquireSharedWriterTransitionClaim } from "./writer-transition-claim";

const schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("extended-absence"),
  handoffId: z.string().uuid(),
  sourceMachineId: z.string().uuid(),
  sourceDisplayName: z.string().min(1).max(80),
  targetMachineId: z.string().uuid().optional(),
  checkpointId: z.string().uuid(),
  rootHash: z.string().regex(/^[a-f0-9]{64}$/),
  backupId: z.string().uuid(),
  durationDays: z.number().int().min(PORTABILITY_LIMITS.minExtendedAbsenceDays).max(PORTABILITY_LIMITS.maxExtendedAbsenceDays),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().optional(),
  status: z.enum(["prepared", "accepted", "rejected"]),
}).strict();

export type ExtendedAbsenceHandoff = z.infer<typeof schema>;

function directory(vaultPath: string): string {
  return path.join(vaultPath, ...PORTABILITY_METADATA_PATH.split("/"), "extended-absence-handoffs");
}

function recordPath(vaultPath: string, handoffId: string): string {
  return path.join(directory(vaultPath), `${z.string().uuid().parse(handoffId)}.json`);
}

export async function readExtendedAbsenceHandoff(vaultPath: string, handoffId: string): Promise<ExtendedAbsenceHandoff> {
  return schema.parse(JSON.parse(await readFile(recordPath(vaultPath, handoffId), "utf8")));
}

export async function listExtendedAbsenceHandoffs(vaultPath: string): Promise<ExtendedAbsenceHandoff[]> {
  try {
    const names = (await readdir(directory(vaultPath))).filter((name) => name.endsWith(".json"));
    const values = await Promise.all(names.map((name) => readFile(path.join(directory(vaultPath), name), "utf8").then((value) => schema.parse(JSON.parse(value)))));
    return values.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function assertPreparationInputs(
  identity: MachineIdentity,
  snapshot: VaultSnapshot,
  checkpoint: Checkpoint,
  backup: BackupRecord,
  options: { durationDays: number; blockingConflicts: number; placeholderCount: number; singleMachineMode: boolean },
): void {
  if (!Number.isInteger(options.durationDays)
    || options.durationDays < PORTABILITY_LIMITS.minExtendedAbsenceDays
    || options.durationDays > PORTABILITY_LIMITS.maxExtendedAbsenceDays) throw new PortabilityError("TRAVEL_DURATION_INVALID");
  if (options.blockingConflicts > 0) throw new PortabilityError("CONFLICTS_BLOCKING");
  if (options.placeholderCount > 0) throw new PortabilityError("PLACEHOLDER_DETECTED");
  if (options.singleMachineMode) throw new PortabilityError("SINGLE_MACHINE_MODE_HANDOFF_BLOCKED");
  if (!backup.verified) throw new PortabilityError("BACKUP_REQUIRED");
  if (backup.manifest.createdByMachineId !== identity.machineId || backup.manifest.sourceRootHash !== snapshot.rootHash) throw new PortabilityError("BACKUP_SNAPSHOT_MISMATCH");
  if (checkpoint.rootHash !== snapshot.rootHash) throw new PortabilityError("CHECKPOINT_MISMATCH");
}

export async function prepareExtendedAbsenceHandoff(
  vaultPath: string,
  identity: MachineIdentity,
  snapshot: VaultSnapshot,
  checkpoint: Checkpoint,
  backup: BackupRecord,
  options: {
    durationDays?: number;
    blockingConflicts?: number;
    placeholderCount?: number;
    singleMachineMode?: boolean;
    now?: Date;
    handoffId?: string;
  } = {},
): Promise<ExtendedAbsenceHandoff> {
  const now = options.now ?? new Date();
  const durationDays = options.durationDays ?? PORTABILITY_LIMITS.defaultExtendedAbsenceDays;
  const handoffId = options.handoffId ?? randomUUID();
  const claim = await acquireSharedWriterTransitionClaim(vaultPath, handoffId, identity.machineId);
  try {
    assertPreparationInputs(identity, snapshot, checkpoint, backup, {
      durationDays,
      blockingConflicts: options.blockingConflicts ?? 0,
      placeholderCount: options.placeholderCount ?? 0,
      singleMachineMode: options.singleMachineMode ?? false,
    });
    const authority = await readWriterAuthority(vaultPath);
    if (!authority || !isAuthorityActive(authority, now) || authority.machineId !== identity.machineId || authority.checkpointId !== checkpoint.checkpointId) {
      throw new PortabilityError("WRITER_AUTHORITY_REQUIRED");
    }
    const pending = (await listExtendedAbsenceHandoffs(vaultPath)).some((item) => item.status === "prepared" && new Date(item.expiresAt).getTime() > now.getTime());
    if (pending) throw new PortabilityError("TRAVEL_HANDOFF_INVALID");
    const handoff = schema.parse({
      schemaVersion: 1,
      kind: "extended-absence",
      handoffId,
      sourceMachineId: identity.machineId,
      sourceDisplayName: identity.displayName,
      checkpointId: checkpoint.checkpointId,
      rootHash: snapshot.rootHash,
      backupId: backup.backupId,
      durationDays,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1_000).toISOString(),
      status: "prepared",
    });
    await atomicWriteJson(recordPath(vaultPath, handoff.handoffId), handoff, true);
    try {
      await releaseWriterAuthority(vaultPath, identity, now);
    } catch (error) {
      const current = await readWriterAuthority(vaultPath).catch(() => null);
      if (current?.machineId !== identity.machineId || current.status !== "released") {
        await rm(recordPath(vaultPath, handoff.handoffId), { force: true }).catch(() => undefined);
        throw error;
      }
    }
    return handoff;
  } finally {
    await claim.release();
  }
}

function acceptedReplay(handoff: ExtendedAbsenceHandoff, identity: MachineIdentity, authority: WriterAuthority | null, now: Date): boolean {
  return handoff.status === "accepted"
    && handoff.targetMachineId === identity.machineId
    && Boolean(authority && authority.machineId === identity.machineId && isAuthorityActive(authority, now));
}

export async function acceptExtendedAbsenceHandoff(
  vaultPath: string,
  handoffId: string,
  identity: MachineIdentity,
  snapshot: VaultSnapshot,
  config: PortabilityConfig,
  options: { now?: Date; blockingConflicts?: number; placeholderCount?: number; confirmationText?: string } = {},
): Promise<{ handoff: ExtendedAbsenceHandoff; authority: WriterAuthority; idempotent: boolean }> {
  if (options.confirmationText !== "ACCEPTER ABSENCE") throw new PortabilityError("TRAVEL_CONFIRMATION_REQUIRED");
  const now = options.now ?? new Date();
  const lock = await acquireSharedWriterTransitionClaim(vaultPath, handoffId, identity.machineId);
  try {
    const handoff = await readExtendedAbsenceHandoff(vaultPath, handoffId);
    const currentAuthority = await readWriterAuthority(vaultPath);
    if (acceptedReplay(handoff, identity, currentAuthority, now)) return { handoff, authority: currentAuthority!, idempotent: true };
    if (handoff.status !== "prepared") throw new PortabilityError("TRAVEL_HANDOFF_CONSUMED");
    if (new Date(handoff.expiresAt).getTime() <= now.getTime()) throw new PortabilityError("TRAVEL_HANDOFF_EXPIRED");
    if (handoff.sourceMachineId === identity.machineId) throw new PortabilityError("TRAVEL_HANDOFF_INVALID");
    if (handoff.rootHash !== snapshot.rootHash) throw new PortabilityError("CHECKPOINT_MISMATCH");
    if ((options.blockingConflicts ?? 0) > 0) throw new PortabilityError("CONFLICTS_BLOCKING");
    if ((options.placeholderCount ?? 0) > 0) throw new PortabilityError("PLACEHOLDER_DETECTED");
    if (!currentAuthority
      || currentAuthority.status !== "released"
      || currentAuthority.machineId !== handoff.sourceMachineId
      || currentAuthority.checkpointId !== handoff.checkpointId) throw new PortabilityError("TRAVEL_HANDOFF_INVALID");
    const checkpoint: Checkpoint = {
      schemaVersion: 1,
      checkpointId: handoff.checkpointId,
      rootHash: handoff.rootHash,
      machineId: handoff.sourceMachineId,
      action: "handoff",
      createdAt: handoff.createdAt,
      backupId: handoff.backupId,
    };
    const authority = await acquireWriterAuthority(vaultPath, identity, checkpoint, config.writerLeaseMinutes, {
      now,
      releasedAuthorityTransfer: { sourceMachineId: handoff.sourceMachineId, targetMachineId: identity.machineId, checkpointId: handoff.checkpointId },
    });
    const accepted = schema.parse({ ...handoff, targetMachineId: identity.machineId, acceptedAt: now.toISOString(), status: "accepted" });
    try { await atomicWriteJson(recordPath(vaultPath, handoffId), accepted); }
    catch (error) {
      try { await atomicWriteJson(writerAuthorityPath(vaultPath), currentAuthority); }
      catch (rollbackError) { throw new PortabilityError("TRAVEL_HANDOFF_INVALID", { cause: rollbackError }); }
      throw error;
    }
    return { handoff: accepted, authority, idempotent: false };
  } finally {
    await lock.release();
  }
}
