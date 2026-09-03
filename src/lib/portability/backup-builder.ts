import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "@/lib/imports/hash";
import { APP_VERSION } from "@/lib/release/version";
import type { PortabilityConfig } from "./config";
import { KNOWLEDGE_BACKUP_ROOTS } from "./constants";
import { atomicWriteJson, windowsPathKey, toPosixPath } from "./filesystem";
import { appendPortabilityHistory } from "./history";
import { backupManifestSchema } from "./backup-schema";
import { createBackupZip } from "./backup-zip";
import { createStableSnapshot, computeRootHash } from "./snapshots";
import type { BackupFile, BackupManifest, BackupProfile, BackupRecord, BackupTrigger, MachineIdentity } from "./types";

function allowed(profile: BackupProfile, relativePath: string): boolean {
  if (relativePath.startsWith(".backups/") || relativePath.startsWith(".tubeknowledge/") || relativePath.startsWith(".git/")) return false;
  if (profile === "full" && relativePath.startsWith(".obsidian/")) return !/(?:^|\/)(?:workspace(?:-mobile)?\.json|cache|trash)(?:\/|$)/i.test(relativePath);
  return KNOWLEDGE_BACKUP_ROOTS.some((root) => relativePath === root || relativePath.startsWith(root));
}

async function collect(vaultPath: string, profile: BackupProfile): Promise<Array<{ path: string; content: Buffer }>> {
  const values: Array<{ path: string; content: Buffer }> = []; const seen = new Set<string>();
  async function visit(directory: string): Promise<void> { for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const target = path.join(directory, entry.name); const relative = toPosixPath(path.relative(vaultPath, target)); const stats = await lstat(target);
    if (stats.isSymbolicLink()) throw new Error(`Lien symbolique interdit dans le backup : ${relative}`);
    if (entry.isDirectory()) { if (!relative.startsWith(".backups") && !relative.startsWith(".tubeknowledge") && !relative.startsWith(".git")) await visit(target); continue; }
    if (!entry.isFile() || !allowed(profile, relative)) continue;
    const key = windowsPathKey(relative); if (seen.has(key)) throw new Error(`Collision de casse : ${relative}`); seen.add(key); values.push({ path: relative, content: await readFile(target) });
  } }
  await visit(vaultPath); return values.sort((a, b) => windowsPathKey(a.path).localeCompare(windowsPathKey(b.path), "en"));
}

async function gitCommit(): Promise<string> { return new Promise((resolve) => execFile("git", ["rev-parse", "--short", "HEAD"], { windowsHide: true }, (error, stdout) => resolve(error ? "unknown" : stdout.trim()))); }
export function backupRecordPath(config: PortabilityConfig, backupId: string): string { return path.join(config.backupPath, `${backupId}.json`); }

export async function createPortabilityBackup(vaultPath: string, config: PortabilityConfig, identity: MachineIdentity, profile: BackupProfile = "knowledge", options: { now?: Date; backupId?: string; appVersion?: string; gitCommit?: string; wait?: (milliseconds: number) => Promise<void>; trigger?: BackupTrigger; relatedId?: string } = {}): Promise<BackupRecord> {
  const now = options.now || new Date(); const backupId = options.backupId || randomUUID(); const sourceSnapshot = await createStableSnapshot(vaultPath, identity.machineId, config.stabilityWindowSeconds, { now, wait: options.wait }); const collected = await collect(vaultPath, profile);
  const manifestFiles: BackupFile[] = collected.map((file) => ({ path: file.path, size: file.content.length, sha256: sha256(file.content) }));
  const manifest: BackupManifest = backupManifestSchema.parse({ schemaVersion: 1, backupId, createdAt: now.toISOString(), createdByMachineId: identity.machineId, profile, sourceSnapshotId: sourceSnapshot.snapshotId, sourceRootHash: computeRootHash(manifestFiles), fileCount: manifestFiles.length, totalBytes: manifestFiles.reduce((sum, file) => sum + file.size, 0), appVersion: options.appVersion || APP_VERSION, gitCommit: options.gitCommit || await gitCommit(), provenance: { trigger: options.trigger || (profile === "before-write" ? "before-write" : "manual"), relatedId: options.relatedId }, files: manifestFiles });
  const validation = { schemaVersion: 1, backupId, verified: true, verifiedAt: now.toISOString(), sourceRootHash: manifest.sourceRootHash, fileCount: manifest.fileCount };
  const zip = await createBackupZip([{ path: "README_RESTORE.md", content: Buffer.from("# TubeKnowledge Backup V1\n\nVérifiez ce backup dans TubeKnowledge avant toute restauration. La restauration vers staging est le mode par défaut.\n") }, { path: "backup-manifest.json", content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) }, { path: "metadata/snapshot.json", content: Buffer.from(`${JSON.stringify(sourceSnapshot, null, 2)}\n`) }, { path: "metadata/validation.json", content: Buffer.from(`${JSON.stringify(validation, null, 2)}\n`) }, ...collected.map((file) => ({ path: `files/${file.path}`, content: file.content }))]);
  await mkdir(config.backupPath, { recursive: true }); const zipPath = path.join(config.backupPath, `${backupId}.zip`); await writeFile(zipPath, zip, { flag: "wx", mode: 0o600 });
  const record: BackupRecord = { backupId, zipPath, zipSha256: sha256(zip), zipBytes: zip.length, verified: true, verifiedAt: now.toISOString(), manifest, pinned: false }; await atomicWriteJson(backupRecordPath(config, backupId), record, true);
  await appendPortabilityHistory(config.statePath, { schemaVersion: 1, eventId: randomUUID(), event: "backup-created", timestamp: now.toISOString(), machineId: identity.machineId, relatedId: backupId, status: "created" });
  await appendPortabilityHistory(config.statePath, { schemaVersion: 1, eventId: randomUUID(), event: "backup-verified", timestamp: now.toISOString(), machineId: identity.machineId, relatedId: backupId, status: "verified" }); return record;
}
