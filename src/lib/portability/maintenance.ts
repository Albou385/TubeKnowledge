import { readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import type { PortabilityConfig } from "./config";
import { PORTABILITY_LIMITS } from "./constants";
import { listBackupRecords } from "./backup-reader";
import { backupRecordPath } from "./backup-builder";
import { writerOperationLockPath } from "./writer-operation-lock";

export interface MaintenanceCandidate {
  kind: "expired-idempotency" | "stale-lock" | "temporary-file" | "backup-retention";
  id: string;
  reason: string;
  protected: boolean;
}

async function expiredRecords(directory: string, now: Date): Promise<Array<{ candidate: MaintenanceCandidate; target: string }>> {
  try {
    const names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    const values = [];
    for (const name of names) {
      const target = path.join(directory, name);
      const parsed = JSON.parse(await readFile(target, "utf8")) as { idempotencyKey?: string; expiresAt?: string };
      if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= now.getTime()) values.push({ candidate: { kind: "expired-idempotency" as const, id: parsed.idempotencyKey || path.basename(name, ".json"), reason: "Fenêtre de replay expirée.", protected: false }, target });
    }
    return values;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function temporaryFiles(root: string): Promise<Array<{ candidate: MaintenanceCandidate; target: string }>> {
  const results: Array<{ candidate: MaintenanceCandidate; target: string }> = [];
  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && (entry.name.endsWith(".tmp") || entry.name.endsWith(".partial"))) results.push({ candidate: { kind: "temporary-file", id: path.relative(root, target).split(path.sep).join("/"), reason: "Fichier technique temporaire.", protected: false }, target });
    }
  }
  await visit(root);
  return results;
}

export async function inspectLocalMaintenance(config: PortabilityConfig, now = new Date()) {
  const targets = [
    ...await expiredRecords(path.join(config.statePath, "writer-bootstrap-idempotency"), now),
    ...await expiredRecords(path.join(config.statePath, "writer-operations-idempotency"), now),
    ...await temporaryFiles(config.statePath),
  ];
  const lockPath = writerOperationLockPath(config);
  try {
    if (now.getTime() - (await stat(lockPath)).mtimeMs > PORTABILITY_LIMITS.writerBootstrapLockStaleMs) targets.push({ candidate: { kind: "stale-lock", id: "writer-operation.lock", reason: "Verrou local expiré.", protected: false }, target: lockPath });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const backups = await listBackupRecords(config);
  const lastVerifiedId = backups.find((item) => item.verified)?.backupId;
  backups.forEach((item, index) => {
    if (index < config.backupRetentionCount) return;
    targets.push({
      candidate: {
        kind: "backup-retention",
        id: item.backupId,
        reason: "Backup local au-delà de la rétention configurée.",
        protected: item.pinned || item.backupId === lastVerifiedId,
      },
      target: item.zipPath,
    });
  });
  return { schemaVersion: 1, generatedAt: now.toISOString(), dryRun: true, candidates: targets.map((item) => item.candidate), targets };
}

export async function applyLocalMaintenance(config: PortabilityConfig, confirmation: string, now = new Date()) {
  if (confirmation !== "NETTOYER") throw new Error("La confirmation exacte NETTOYER est requise.");
  const inspection = await inspectLocalMaintenance(config, now);
  const removed: MaintenanceCandidate[] = [];
  for (const item of inspection.targets) {
    if (item.candidate.protected) continue;
    if (item.candidate.kind === "backup-retention") {
      const record = (await listBackupRecords(config)).find((value) => value.backupId === item.candidate.id);
      if (!record || record.pinned) continue;
      const lastVerified = (await listBackupRecords(config)).find((value) => value.verified);
      if (lastVerified?.backupId === record.backupId) continue;
      await rm(record.zipPath, { force: true });
      await rm(backupRecordPath(config, record.backupId), { force: true });
    } else {
      await rm(item.target, { force: true });
    }
    removed.push(item.candidate);
  }
  return { schemaVersion: 1, applied: true, removed };
}
