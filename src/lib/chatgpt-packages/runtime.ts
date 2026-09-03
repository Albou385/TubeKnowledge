import { randomUUID } from "node:crypto";
import { appendFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getRuntimeLocation } from "@/lib/transcription/runtime-location";

import { packageStatusSchema, type ChatGptPackageManifest, type PackageEventType, type PackageStatus } from "./schema";

export interface PackagePreviewRecord {
  tree: string[];
  request: string;
  manifest: ChatGptPackageManifest;
  snapshot: Record<string, string>;
  estimates: { words: number; characters: number; tokenEstimate: number; segments: number; contexts: number; uncompressedBytes: number; zipBytes?: number };
}

export interface PackageStatusRecord {
  schemaVersion: 1;
  packageId: string;
  status: PackageStatus;
  createdAt: string;
  updatedAt: string;
  zipSha256: string;
  zipBytes: number;
  resultSha256?: string;
  importId?: string;
  backupId?: string;
  importedAt?: string;
  lastError?: string;
}

export interface StoredChatGptPackage {
  manifest: ChatGptPackageManifest;
  preview: PackagePreviewRecord;
  status: PackageStatusRecord;
}

export function packagesRuntimePath(environment: NodeJS.ProcessEnv = process.env): string {
  return path.join(getRuntimeLocation(environment).runtimePath, "chatgpt-packages");
}

export function assertPackageId(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error("packageId invalide.");
  return id;
}

function packageDirectory(root: string, id: string): string {
  return path.join(root, assertPackageId(id));
}

async function assertRegular(target: string): Promise<void> {
  const details = await lstat(target);
  if (details.isSymbolicLink()) throw new Error("Lien symbolique interdit dans le runtime des paquets.");
}

async function atomicJson(target: string, value: unknown): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, target);
}

async function appendHistory(root: string, packageId: string, event: PackageEventType, status: PackageStatus, details: Record<string, string | undefined> = {}): Promise<void> {
  const entry = { schemaVersion: 1, packageId, event, status, timestamp: new Date().toISOString(), ...details };
  const serialized = JSON.stringify(entry);
  if (/([a-z]:\\|\\\\|\/Users\/|\/home\/)/i.test(serialized)) throw new Error("L’historique contient un chemin absolu.");
  await mkdir(root, { recursive: true });
  await appendFile(path.join(root, "history.jsonl"), `${serialized}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function saveGeneratedPackage(input: { manifest: ChatGptPackageManifest; preview: PackagePreviewRecord; zip: Buffer; zipSha256: string }, root = packagesRuntimePath()): Promise<StoredChatGptPackage> {
  const directory = packageDirectory(root, input.manifest.packageId);
  await mkdir(root, { recursive: true });
  try { await lstat(directory); throw new Error("Ce packageId existe déjà."); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await mkdir(directory, { recursive: false });
  const now = input.manifest.generatedAt;
  const status: PackageStatusRecord = { schemaVersion: 1, packageId: input.manifest.packageId, status: "ready", createdAt: now, updatedAt: now, zipSha256: input.zipSha256, zipBytes: input.zip.length };
  await Promise.all([
    atomicJson(path.join(directory, "package.json"), input.manifest),
    atomicJson(path.join(directory, "preview.json"), { ...input.preview, estimates: { ...input.preview.estimates, zipBytes: input.zip.length } }),
    atomicJson(path.join(directory, "status.json"), status),
    writeFile(path.join(directory, "package.zip"), input.zip, { mode: 0o600, flag: "wx" }),
    writeFile(path.join(directory, "package-sha256.txt"), `${input.zipSha256}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }),
  ]);
  await appendHistory(root, input.manifest.packageId, "package-created", "ready");
  return { manifest: input.manifest, preview: { ...input.preview, estimates: { ...input.preview.estimates, zipBytes: input.zip.length } }, status };
}

export async function loadStoredPackage(id: string, root = packagesRuntimePath()): Promise<StoredChatGptPackage> {
  const directory = packageDirectory(root, id);
  await assertRegular(directory);
  const [manifestText, previewText, statusText] = await Promise.all([
    readFile(path.join(directory, "package.json"), "utf8"),
    readFile(path.join(directory, "preview.json"), "utf8"),
    readFile(path.join(directory, "status.json"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText) as ChatGptPackageManifest;
  const preview = JSON.parse(previewText) as PackagePreviewRecord;
  const status = JSON.parse(statusText) as PackageStatusRecord;
  packageStatusSchema.parse(status.status);
  if (manifest.packageId !== id || status.packageId !== id) throw new Error("Runtime de paquet incohérent.");
  return { manifest, preview, status };
}

export async function listStoredPackages(root = packagesRuntimePath()): Promise<StoredChatGptPackage[]> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const packages: StoredChatGptPackage[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    try { packages.push(await loadStoredPackage(entry.name, root)); } catch { /* Une entrée corrompue n’est jamais exposée. */ }
  }
  return packages.sort((a, b) => b.status.createdAt.localeCompare(a.status.createdAt));
}

export async function packageZipPath(id: string, root = packagesRuntimePath()): Promise<string> {
  const directory = packageDirectory(root, id);
  await assertRegular(directory);
  const target = path.join(directory, "package.zip");
  await assertRegular(target);
  return target;
}

export async function updatePackageStatus(id: string, status: PackageStatus, input: { event: PackageEventType; resultSha256?: string; importId?: string; backupId?: string; lastError?: string }, root = packagesRuntimePath()): Promise<StoredChatGptPackage> {
  const stored = await loadStoredPackage(id, root);
  const updated: PackageStatusRecord = { ...stored.status, status, updatedAt: new Date().toISOString(), resultSha256: input.resultSha256 ?? stored.status.resultSha256, importId: input.importId ?? stored.status.importId, backupId: input.backupId ?? stored.status.backupId, importedAt: status === "imported" ? new Date().toISOString() : stored.status.importedAt, lastError: input.lastError };
  await atomicJson(path.join(packageDirectory(root, id), "status.json"), updated);
  await appendHistory(root, id, input.event, status, { importId: input.importId, backupId: input.backupId });
  return { ...stored, status: updated };
}

export async function storeResultZip(id: string, zip: Buffer, hash: string, root = packagesRuntimePath()): Promise<void> {
  const directory = packageDirectory(root, id);
  await assertRegular(directory);
  const target = path.join(directory, "result.zip");
  try { await writeFile(target, zip, { mode: 0o600, flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; await writeFile(target, zip, { mode: 0o600 }); }
  await updatePackageStatus(id, "result-received", { event: "result-uploaded", resultSha256: hash }, root);
}

export async function deleteStoredPackage(id: string, confirmed: boolean, root = packagesRuntimePath()): Promise<void> {
  if (!confirmed) throw new Error("Confirmation explicite requise.");
  const stored = await loadStoredPackage(id, root);
  await appendHistory(root, id, "package-deleted", "deleted");
  await rm(packageDirectory(root, stored.manifest.packageId), { recursive: true, force: true });
}

export async function readPackageHistory(id: string, root = packagesRuntimePath()): Promise<Array<Record<string, unknown>>> {
  assertPackageId(id);
  try {
    return (await readFile(path.join(root, "history.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>).filter((entry) => entry.packageId === id);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
