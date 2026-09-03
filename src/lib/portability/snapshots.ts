import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "@/lib/imports/hash";
import type { PortabilityConfig } from "./config";
import { PORTABILITY_LIMITS, SNAPSHOT_EXCLUDED_PREFIXES } from "./constants";
import { PortabilityError } from "./errors";
import { atomicWriteJson, windowsPathKey, toPosixPath } from "./filesystem";
import { probeWindowsAttributes, type AttributeProbe } from "./one-drive";
import type { SnapshotFile, VaultSnapshot } from "./types";

export interface SnapshotOptions { now?: Date; snapshotId?: string; maxFiles?: number; include?: (relativePath: string) => boolean; attributeProbe?: AttributeProbe }

export function latestSnapshotPath(config: PortabilityConfig): string { return path.join(config.statePath, "latest-snapshot.json"); }

export async function readLatestSnapshot(config: PortabilityConfig): Promise<VaultSnapshot | null> {
  try { return JSON.parse(await readFile(latestSnapshotPath(config), "utf8")) as VaultSnapshot; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function persistLatestSnapshot(config: PortabilityConfig, snapshot: VaultSnapshot): Promise<void> {
  await atomicWriteJson(latestSnapshotPath(config), snapshot);
}

function isExcluded(relativePath: string): boolean {
  const slash = `${toPosixPath(relativePath).replace(/^\.\//, "")}${relativePath.endsWith(path.sep) ? "/" : ""}`;
  return SNAPSHOT_EXCLUDED_PREFIXES.some((prefix) => slash === prefix.slice(0, -1) || slash.startsWith(prefix));
}

export function computeRootHash(files: readonly Pick<SnapshotFile, "path" | "sha256" | "size">[]): string {
  const root = createHash("sha256");
  for (const file of [...files].sort((a, b) => windowsPathKey(a.path).localeCompare(windowsPathKey(b.path), "en"))) {
    root.update(Buffer.from(windowsPathKey(file.path), "utf8")); root.update(Buffer.from([0]));
    root.update(Buffer.from(file.sha256, "hex")); root.update(Buffer.from([0]));
    root.update(Buffer.from(String(file.size), "ascii")); root.update(Buffer.from([10]));
  }
  return root.digest("hex");
}

export async function createVaultSnapshot(rootPath: string, machineId: string, options: SnapshotOptions = {}): Promise<VaultSnapshot> {
  const maxFiles = options.maxFiles ?? PORTABILITY_LIMITS.maxSnapshotFiles;
  const files: SnapshotFile[] = [];
  const seen = new Set<string>();
  async function visit(directory: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const target = path.join(directory, entry.name); const relativePath = toPosixPath(path.relative(rootPath, target));
      if (isExcluded(relativePath)) continue;
      const details = await lstat(target);
      if (details.isSymbolicLink()) throw new Error(`Lien symbolique ou reparse point interdit : ${relativePath}`);
      if (details.isDirectory()) { await visit(target); continue; }
      if (!details.isFile() || (options.include && !options.include(relativePath))) continue;
      if (details.size > PORTABILITY_LIMITS.maxFileBytes) throw new Error(`Fichier trop volumineux : ${relativePath}`);
      const key = windowsPathKey(relativePath);
      if (seen.has(key)) throw new Error(`Collision de casse Windows : ${relativePath}`);
      seen.add(key);
      if (files.length >= maxFiles) throw new Error(`Le snapshot dépasse ${maxFiles} fichiers.`);
      const attributes = await (options.attributeProbe || probeWindowsAttributes)(target); if (attributes.offline || attributes.unpinned) throw new PortabilityError("PLACEHOLDER_DETECTED");
      const content = await readFile(target);
      files.push({ path: relativePath, size: content.length, sha256: sha256(content), modifiedAt: details.mtime.toISOString() });
    }
  }
  await visit(rootPath);
  files.sort((a, b) => windowsPathKey(a.path).localeCompare(windowsPathKey(b.path), "en"));
  return { schemaVersion: 1, snapshotId: options.snapshotId || randomUUID(), createdAt: (options.now || new Date()).toISOString(), machineId, fileCount: files.length, totalBytes: files.reduce((sum, file) => sum + file.size, 0), rootHash: computeRootHash(files), files };
}

export function compareSnapshots(first: VaultSnapshot, second: VaultSnapshot): { stable: boolean; changedPaths: string[] } {
  const before = new Map(first.files.map((file) => [windowsPathKey(file.path), file])); const after = new Map(second.files.map((file) => [windowsPathKey(file.path), file]));
  const changed = new Set<string>();
  for (const [key, file] of before) { const next = after.get(key); if (!next || next.sha256 !== file.sha256 || next.size !== file.size || next.modifiedAt !== file.modifiedAt) changed.add(file.path); }
  for (const [key, file] of after) if (!before.has(key)) changed.add(file.path);
  return { stable: changed.size === 0, changedPaths: [...changed].sort((a, b) => a.localeCompare(b, "en")) };
}

export function changedKnowledgePaths(first: VaultSnapshot, second: VaultSnapshot): string[] {
  const before = new Map(first.files.map((file) => [windowsPathKey(file.path), file]));
  const after = new Map(second.files.map((file) => [windowsPathKey(file.path), file]));
  const changed = new Set<string>();
  for (const [key, file] of before) { const next = after.get(key); if (!next || next.sha256 !== file.sha256 || next.size !== file.size) changed.add(file.path); }
  for (const [key, file] of after) if (!before.has(key)) changed.add(file.path);
  return [...changed].sort((a, b) => windowsPathKey(a).localeCompare(windowsPathKey(b), "en"));
}

export async function createStableSnapshot(rootPath: string, machineId: string, windowSeconds: number, options: SnapshotOptions & { wait?: (milliseconds: number) => Promise<void> } = {}): Promise<VaultSnapshot> {
  const first = await createVaultSnapshot(rootPath, machineId, options);
  await (options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))))(windowSeconds * 1000);
  const second = await createVaultSnapshot(rootPath, machineId, options);
  if (!compareSnapshots(first, second).stable) throw new Error("VAULT_UNSTABLE");
  return second;
}
