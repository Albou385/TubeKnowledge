import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { sha256 } from "@/lib/imports/hash";
import type { PortabilityConfig } from "./config";
import { backupManifestSchema } from "./backup-schema";
import { readBackupZip } from "./backup-zip";
import { backupRecordPath } from "./backup-builder";
import { computeRootHash } from "./snapshots";
import type { BackupRecord } from "./types";

const uuid = z.string().uuid();
export async function loadBackupRecord(config: PortabilityConfig, backupId: string): Promise<BackupRecord> { return JSON.parse(await readFile(backupRecordPath(config, uuid.parse(backupId)), "utf8")) as BackupRecord; }
export async function listBackupRecords(config: PortabilityConfig): Promise<BackupRecord[]> { try { const names = (await readdir(config.backupPath)).filter((name) => name.endsWith(".json")); return (await Promise.all(names.map((name) => readFile(path.join(config.backupPath, name), "utf8").then((value) => JSON.parse(value) as BackupRecord)))).sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } }

export async function verifyPortabilityBackup(config: PortabilityConfig, backupId: string): Promise<{ record: BackupRecord; files: Map<string, Buffer> }> {
  const record = await loadBackupRecord(config, backupId); const zip = await readFile(record.zipPath); if (sha256(zip) !== record.zipSha256) throw new Error("BACKUP_INVALID");
  const files = await readBackupZip(zip); const manifestBuffer = files.get("backup-manifest.json"); const validationBuffer = files.get("metadata/validation.json"); if (!manifestBuffer || !validationBuffer) throw new Error("BACKUP_INVALID");
  const manifest = backupManifestSchema.parse(JSON.parse(manifestBuffer.toString("utf8"))); if (manifest.backupId !== backupId) throw new Error("BACKUP_INVALID");
  const validation = JSON.parse(validationBuffer.toString("utf8")) as { verified?: boolean; backupId?: string }; if (!validation.verified || validation.backupId !== backupId) throw new Error("BACKUP_INVALID");
  for (const item of manifest.files) { const content = files.get(`files/${item.path}`.toLocaleLowerCase("en-US")); if (!content || content.length !== item.size || sha256(content) !== item.sha256) throw new Error("BACKUP_INVALID"); }
  if (computeRootHash(manifest.files) !== manifest.sourceRootHash || manifest.fileCount !== manifest.files.length) throw new Error("BACKUP_INVALID"); return { record: { ...record, manifest, verified: true }, files };
}

