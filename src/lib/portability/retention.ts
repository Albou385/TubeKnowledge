import { rm } from "node:fs/promises";

import type { PortabilityConfig } from "./config";
import { backupRecordPath } from "./backup-builder";
import { listBackupRecords } from "./backup-reader";
import { atomicWriteJson } from "./filesystem";

export async function deleteBackupExplicitly(config: PortabilityConfig, backupId: string, confirmed: boolean): Promise<void> {
  if (!confirmed) throw new Error("Confirmation explicite requise."); const records = await listBackupRecords(config); const record = records.find((item) => item.backupId === backupId); if (!record) throw new Error("Backup inconnu.");
  if (record.pinned) throw new Error("Un backup épinglé ne peut pas être supprimé."); if (record.verified && records.filter((item) => item.verified).length <= 1) throw new Error("Le dernier backup vérifié doit être conservé.");
  await rm(record.zipPath, { force: true }); await rm(backupRecordPath(config, backupId), { force: true });
}

export async function setBackupPinned(config: PortabilityConfig, backupId: string, pinned: boolean): Promise<void> { const records = await listBackupRecords(config); const record = records.find((item) => item.backupId === backupId); if (!record) throw new Error("Backup inconnu."); await atomicWriteJson(backupRecordPath(config, backupId), { ...record, pinned }); }
