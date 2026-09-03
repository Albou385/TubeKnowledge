import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "@/lib/imports/hash";
import type { PortabilityConfig } from "./config";
import { assertConfinedPath, windowsPathKey } from "./filesystem";
import { verifyPortabilityBackup } from "./backup-reader";
import type { RestoreOperation, RestorePreview } from "./types";

interface StoredRestorePreview extends RestorePreview { targetRoot: string; mirror: boolean }
export function restoreSessionPath(config: PortabilityConfig, restoreId: string): string { return path.join(config.statePath, "restore-sessions", `${restoreId}.json`); }

async function currentHash(root: string, relativePath: string): Promise<string | null> { try { const target = await assertConfinedPath(root, relativePath); const stats = await lstat(target); if (!stats.isFile() || stats.isSymbolicLink()) return null; return sha256(await readFile(target)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } }

async function listCurrentFiles(root: string): Promise<string[]> {
  const { createVaultSnapshot } = await import("./snapshots"); const snapshot = await createVaultSnapshot(root, "00000000-0000-4000-8000-000000000000"); return snapshot.files.map((file) => file.path);
}

export async function previewRestore(config: PortabilityConfig, input: { backupId: string; mode: "restore-to-staging" | "restore-in-place"; targetRoot: string; mirror?: boolean }, options: { now?: Date; restoreId?: string } = {}): Promise<RestorePreview> {
  const { record } = await verifyPortabilityBackup(config, input.backupId); const now = options.now || new Date(); const operations: RestoreOperation[] = []; const backupPaths = new Set(record.manifest.files.map((file) => windowsPathKey(file.path)));
  for (const file of record.manifest.files) { const currentSha256 = await currentHash(input.targetRoot, file.path); operations.push({ type: currentSha256 === null ? "create" : currentSha256 === file.sha256 ? "unchanged" : "replace", path: file.path, currentSha256, backupSha256: file.sha256 }); }
  try { for (const relativePath of await listCurrentFiles(input.targetRoot)) if (!backupPaths.has(windowsPathKey(relativePath))) operations.push({ type: "delete-candidate", path: relativePath, currentSha256: await currentHash(input.targetRoot, relativePath), backupSha256: null }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  operations.sort((a, b) => windowsPathKey(a.path).localeCompare(windowsPathKey(b.path), "en")); const preview: StoredRestorePreview = { restoreId: options.restoreId || randomUUID(), backupId: input.backupId, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(), mode: input.mode, operations, sourceRootHash: record.manifest.sourceRootHash, verified: record.verified, targetRoot: path.resolve(input.targetRoot), mirror: Boolean(input.mirror) };
  await mkdir(path.dirname(restoreSessionPath(config, preview.restoreId)), { recursive: true }); await writeFile(restoreSessionPath(config, preview.restoreId), JSON.stringify(preview), { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { restoreId: preview.restoreId, backupId: preview.backupId, createdAt: preview.createdAt, expiresAt: preview.expiresAt, mode: preview.mode, operations: preview.operations, sourceRootHash: preview.sourceRootHash, verified: preview.verified };
}

export async function readRestorePreview(config: PortabilityConfig, restoreId: string, now = new Date()): Promise<StoredRestorePreview> { const preview = JSON.parse(await readFile(restoreSessionPath(config, restoreId), "utf8")) as StoredRestorePreview; if (preview.restoreId !== restoreId || new Date(preview.expiresAt).getTime() <= now.getTime()) throw new Error("RESTORE_PREVIEW_REQUIRED"); return preview; }
