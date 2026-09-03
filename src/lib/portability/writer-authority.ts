import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { PORTABILITY_METADATA_PATH } from "./constants";
import { PortabilityError } from "./errors";
import { atomicWriteJson } from "./filesystem";
import type { Checkpoint, MachineIdentity, WriterAuthority } from "./types";

const schema = z.object({ schemaVersion: z.literal(1), authorityId: z.string().uuid(), machineId: z.string().uuid(), displayName: z.string().min(1).max(80), grantedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), checkpointId: z.string().uuid(), status: z.enum(["active", "released"]) }).strict();
export function writerAuthorityPath(vaultPath: string): string { return path.join(vaultPath, ...PORTABILITY_METADATA_PATH.split("/"), "writer-authority.json"); }
export async function readWriterAuthority(vaultPath: string): Promise<WriterAuthority | null> { try { return schema.parse(JSON.parse(await readFile(writerAuthorityPath(vaultPath), "utf8"))); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } }
export function isAuthorityActive(authority: WriterAuthority, now = new Date()): boolean { return authority.status === "active" && new Date(authority.expiresAt).getTime() > now.getTime(); }

export async function renewWriterAuthority(vaultPath: string, identity: MachineIdentity, leaseMinutes: number, now = new Date()): Promise<WriterAuthority> {
  const existing = await readWriterAuthority(vaultPath);
  if (!existing || !isAuthorityActive(existing, now) || existing.machineId !== identity.machineId) throw new PortabilityError("WRITER_RENEWAL_NOT_ALLOWED");
  const renewed = schema.parse({ ...existing, expiresAt: new Date(now.getTime() + leaseMinutes * 60_000).toISOString() });
  await atomicWriteJson(writerAuthorityPath(vaultPath), renewed);
  return renewed;
}

export async function reacquireWriterAuthority(vaultPath: string, identity: MachineIdentity, checkpoint: Checkpoint, leaseMinutes: number, now = new Date(), authorityId?: string): Promise<WriterAuthority> {
  const existing = await readWriterAuthority(vaultPath);
  if (!existing || existing.status !== "active") throw new PortabilityError("WRITER_UNINITIALIZED");
  if (isAuthorityActive(existing, now)) throw new PortabilityError(existing.machineId === identity.machineId ? "WRITER_ACTIVE_LOCAL" : "WRITER_ACTIVE_REMOTE");
  if (existing.machineId !== identity.machineId) throw new PortabilityError("WRITER_EXPIRED_REMOTE");
  const authority = schema.parse({
    ...existing,
    authorityId: authorityId || randomUUID(),
    displayName: identity.displayName,
    grantedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + leaseMinutes * 60_000).toISOString(),
    checkpointId: checkpoint.checkpointId,
    status: "active",
  });
  await atomicWriteJson(writerAuthorityPath(vaultPath), authority);
  return authority;
}

export async function recoverExpiredRemoteWriterAuthority(
  vaultPath: string,
  identity: MachineIdentity,
  checkpoint: Checkpoint,
  expected: WriterAuthority,
  leaseMinutes: number,
  now = new Date(),
  authorityId?: string,
): Promise<WriterAuthority> {
  const current = await readWriterAuthority(vaultPath);
  if (!current
    || current.authorityId !== expected.authorityId
    || current.machineId !== expected.machineId
    || current.checkpointId !== expected.checkpointId
    || current.expiresAt !== expected.expiresAt
    || current.status !== "active"
    || current.machineId === identity.machineId
    || isAuthorityActive(current, now)
    || checkpoint.checkpointId !== current.checkpointId) {
    throw new PortabilityError("WRITER_DISASTER_RECOVERY_STATE_CHANGED");
  }
  const recovered = schema.parse({
    schemaVersion: 1,
    authorityId: authorityId || randomUUID(),
    machineId: identity.machineId,
    displayName: identity.displayName,
    grantedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + leaseMinutes * 60_000).toISOString(),
    checkpointId: checkpoint.checkpointId,
    status: "active",
  });
  await atomicWriteJson(writerAuthorityPath(vaultPath), recovered);
  return recovered;
}

export async function acquireWriterAuthority(vaultPath: string, identity: MachineIdentity, checkpoint: Checkpoint, leaseMinutes: number, options: { now?: Date; force?: boolean; verifiedBackupId?: string; confirmationText?: string; authorityId?: string; releasedAuthorityTransfer?: { sourceMachineId: string; targetMachineId: string; checkpointId: string } } = {}): Promise<WriterAuthority> {
  const now = options.now || new Date(); const existing = await readWriterAuthority(vaultPath);
  if (options.force && (!options.verifiedBackupId || options.confirmationText !== "REPRENDRE")) throw new PortabilityError("BACKUP_REQUIRED");
  if (existing && isAuthorityActive(existing, now) && existing.machineId !== identity.machineId) {
    throw new PortabilityError("WRITER_ACTIVE_ELSEWHERE");
  }
  if (existing && isAuthorityActive(existing, now) && existing.machineId === identity.machineId) return existing;
  if (!options.force) {
    const transfer = options.releasedAuthorityTransfer;
    if (!existing
      || existing.status !== "released"
      || !transfer
      || transfer.sourceMachineId !== existing.machineId
      || transfer.targetMachineId !== identity.machineId
      || transfer.checkpointId !== checkpoint.checkpointId
      || existing.checkpointId !== checkpoint.checkpointId) throw new PortabilityError("HANDOFF_REQUIRED");
  }
  const authority = schema.parse({ schemaVersion: 1, authorityId: options.authorityId || randomUUID(), machineId: identity.machineId, displayName: identity.displayName, grantedAt: now.toISOString(), expiresAt: new Date(now.getTime() + leaseMinutes * 60_000).toISOString(), checkpointId: checkpoint.checkpointId, status: "active" });
  await atomicWriteJson(writerAuthorityPath(vaultPath), authority); return authority;
}

export async function assertWriterAuthority(vaultPath: string, identity: MachineIdentity, now = new Date()): Promise<WriterAuthority> {
  const authority = await readWriterAuthority(vaultPath);
  if (!authority || authority.status !== "active") throw new PortabilityError("WRITER_AUTHORITY_REQUIRED");
  if (!isAuthorityActive(authority, now)) throw new PortabilityError(authority.machineId === identity.machineId ? "WRITER_EXPIRED_LOCAL" : "WRITER_EXPIRED_REMOTE");
  if (authority.machineId !== identity.machineId) throw new PortabilityError("WRITER_ACTIVE_ELSEWHERE");
  return authority;
}

export async function releaseWriterAuthority(vaultPath: string, identity: MachineIdentity, now = new Date()): Promise<void> {
  const authority = await assertWriterAuthority(vaultPath, identity, now); await atomicWriteJson(writerAuthorityPath(vaultPath), { ...authority, status: "released" });
}

export async function advanceWriterCheckpoint(vaultPath: string, identity: MachineIdentity, checkpointId: string, now = new Date()): Promise<WriterAuthority> {
  const authority = await assertWriterAuthority(vaultPath, identity, now);
  const updated = schema.parse({ ...authority, checkpointId });
  await atomicWriteJson(writerAuthorityPath(vaultPath), updated);
  return updated;
}

export async function clearReleasedAuthority(vaultPath: string): Promise<void> { const authority = await readWriterAuthority(vaultPath); if (authority?.status === "released") await rm(writerAuthorityPath(vaultPath), { force: true }); }
