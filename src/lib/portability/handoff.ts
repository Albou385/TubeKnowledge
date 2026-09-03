import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { PortabilityConfig } from "./config";
import { PORTABILITY_METADATA_PATH, PORTABILITY_LIMITS } from "./constants";
import { PortabilityError } from "./errors";
import { atomicWriteJson } from "./filesystem";
import { assertWriterAuthority, releaseWriterAuthority } from "./writer-authority";
import { acquireSharedWriterTransitionClaim } from "./writer-transition-claim";
import type { BackupRecord, Checkpoint, Handoff, MachineIdentity, VaultSnapshot } from "./types";

const schema = z.object({ schemaVersion: z.literal(1), handoffId: z.string().uuid(), sourceMachineId: z.string().uuid(), sourceDisplayName: z.string().min(1).max(80), targetMachineId: z.string().uuid().optional(), checkpointId: z.string().uuid(), rootHash: z.string().regex(/^[a-f0-9]{64}$/), backupId: z.string().uuid(), createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(), status: z.enum(["prepared", "accepted", "consumed", "rejected"]) }).strict();
function handoffPath(vaultPath: string, id: string): string { return path.join(vaultPath, ...PORTABILITY_METADATA_PATH.split("/"), "handoffs", `${z.string().uuid().parse(id)}.json`); }
function handoffDirectory(vaultPath: string): string { return path.join(vaultPath, ...PORTABILITY_METADATA_PATH.split("/"), "handoffs"); }

export async function prepareHandoff(vaultPath: string, identity: MachineIdentity, snapshot: VaultSnapshot, checkpoint: Checkpoint, backup: BackupRecord, options: { now?: Date; handoffId?: string } = {}): Promise<Handoff> {
  const handoffId = options.handoffId || randomUUID();
  const claim = await acquireSharedWriterTransitionClaim(vaultPath, handoffId, identity.machineId);
  try {
    await assertWriterAuthority(vaultPath, identity, options.now); if (!backup.verified) throw new PortabilityError("BACKUP_REQUIRED"); if (checkpoint.rootHash !== snapshot.rootHash) throw new PortabilityError("CHECKPOINT_MISMATCH");
    const now = options.now || new Date(); const handoff = schema.parse({ schemaVersion: 1, handoffId, sourceMachineId: identity.machineId, sourceDisplayName: identity.displayName, checkpointId: checkpoint.checkpointId, rootHash: snapshot.rootHash, backupId: backup.backupId, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + PORTABILITY_LIMITS.handoffTtlMs).toISOString(), status: "prepared" });
    await atomicWriteJson(handoffPath(vaultPath, handoff.handoffId), handoff, true); await releaseWriterAuthority(vaultPath, identity, now); return handoff;
  } finally {
    await claim.release();
  }
}

export async function readHandoff(vaultPath: string, handoffId: string): Promise<Handoff> { return schema.parse(JSON.parse(await readFile(handoffPath(vaultPath, handoffId), "utf8"))); }
export async function listHandoffs(vaultPath: string): Promise<Handoff[]> {
  try {
    const names = (await readdir(handoffDirectory(vaultPath))).filter((name) => name.endsWith(".json"));
    const values = await Promise.all(names.map((name) => readFile(path.join(handoffDirectory(vaultPath), name), "utf8").then((value) => schema.parse(JSON.parse(value)))));
    return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
export async function acceptHandoff(vaultPath: string, handoffId: string, identity: MachineIdentity, snapshot: VaultSnapshot, config: PortabilityConfig, options: { now?: Date; blockingConflicts?: number; placeholderCount?: number }): Promise<Handoff> {
  const claim = await acquireSharedWriterTransitionClaim(vaultPath, handoffId, identity.machineId);
  try {
    const now = options.now || new Date(); const handoff = await readHandoff(vaultPath, handoffId); if (handoff.status !== "prepared" || new Date(handoff.expiresAt).getTime() <= now.getTime()) throw new PortabilityError("HANDOFF_REQUIRED");
    if (handoff.sourceMachineId === identity.machineId || (handoff.targetMachineId && handoff.targetMachineId !== identity.machineId)) throw new PortabilityError("HANDOFF_REQUIRED"); if (handoff.rootHash !== snapshot.rootHash) throw new PortabilityError("CHECKPOINT_MISMATCH");
    if (options.blockingConflicts || options.placeholderCount) throw new PortabilityError(options.placeholderCount ? "PLACEHOLDER_DETECTED" : "CONFLICTS_BLOCKING");
    const accepted = schema.parse({ ...handoff, targetMachineId: identity.machineId, status: "accepted" }); await atomicWriteJson(handoffPath(vaultPath, handoffId), accepted); return accepted;
  } finally {
    await claim.release();
  }
}

export async function consumeAcceptedHandoff(vaultPath: string, handoffId: string, identity: MachineIdentity): Promise<Handoff> {
  const handoff = await readHandoff(vaultPath, handoffId);
  if (handoff.status === "consumed" && handoff.targetMachineId === identity.machineId) return handoff;
  if (handoff.status !== "accepted" || handoff.targetMachineId !== identity.machineId) throw new PortabilityError("HANDOFF_REQUIRED");
  const consumed = schema.parse({ ...handoff, status: "consumed" });
  await atomicWriteJson(handoffPath(vaultPath, handoffId), consumed);
  return consumed;
}

