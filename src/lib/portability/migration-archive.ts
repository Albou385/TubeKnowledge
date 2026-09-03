import { randomUUID } from "node:crypto";

import yauzl, { type Entry, type ZipFile } from "yauzl";
import yazl from "yazl";
import { z } from "zod";

import { sha256 } from "@/lib/imports/hash";

import { PORTABILITY_LIMITS } from "./constants";
import { assertRelativeSafePath, windowsPathKey } from "./filesystem";

export const MIGRATION_ROOT = "tubeknowledge-migration";

const fileSchema = z.object({
  path: z.string().min(1).max(1_024),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  category: z.enum(["queue", "workflows", "acquisitions", "packages", "assistant", "apply-sessions", "portability-backup", "target-backup"]),
}).strict();

export const migrationManifestSchema = z.object({
  schemaVersion: z.literal(1),
  bundleId: z.string().uuid(),
  createdAt: z.iso.datetime(),
  sourceRootHash: z.string().regex(/^[a-f0-9]{64}$/),
  gitCommit: z.string().regex(/^[a-f0-9]{7,40}$/),
  backupId: z.string().uuid().nullable(),
  files: z.array(fileSchema).max(PORTABILITY_LIMITS.maxBackupEntries),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
}).strict();

export type MigrationManifest = z.infer<typeof migrationManifestSchema>;
export type MigrationCategory = MigrationManifest["files"][number]["category"];
export interface MigrationSourceFile { path: string; content: Buffer; category: MigrationCategory }

function openZip(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => error || !zip ? reject(error ?? new Error("Archive de migration invalide.")) : resolve(zip)));
}

function readEntry(zip: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => {
    if (error || !stream) return reject(error ?? new Error("Entrée de migration illisible."));
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(Buffer.concat(chunks)));
  }));
}

function isSymlink(entry: Entry): boolean {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (mode & 0o170000) === 0o120000;
}

export function validateMigrationArchiveEntryName(name: string): string {
  if (name.includes("\\") || name.includes("\0") || name.startsWith("/") || /^[a-z]:/i.test(name) || name.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error("Chemin dangereux dans l’archive de migration.");
  }
  const prefix = `${MIGRATION_ROOT}/`;
  if (!name.startsWith(prefix) || name === prefix || name.endsWith("/")) throw new Error("L’archive doit avoir une racine unique tubeknowledge-migration/.");
  return assertRelativeSafePath(name.slice(prefix.length));
}

function normalizedSourceFiles(files: MigrationSourceFile[]): MigrationSourceFile[] {
  const seen = new Set<string>();
  const ordered = [...files].map((file) => ({ ...file, path: assertRelativeSafePath(file.path) })).sort((left, right) => windowsPathKey(left.path).localeCompare(windowsPathKey(right.path), "en"));
  let total = 0;
  for (const file of ordered) {
    const key = windowsPathKey(file.path);
    if (seen.has(key)) throw new Error(`Collision de chemin de migration : ${file.path}`);
    seen.add(key);
    total += file.content.length;
    if (seen.size > PORTABILITY_LIMITS.maxBackupEntries || total > PORTABILITY_LIMITS.maxBackupBytes || file.content.length > PORTABILITY_LIMITS.maxFileBytes) throw new Error("Limites du bundle de migration dépassées.");
  }
  return ordered;
}

export async function createMigrationArchive(
  files: MigrationSourceFile[],
  options: { sourceRootHash: string; gitCommit: string; backupId?: string | null; bundleId?: string; now?: Date },
): Promise<{ archive: Buffer; manifest: MigrationManifest }> {
  const ordered = normalizedSourceFiles(files);
  const manifest = migrationManifestSchema.parse({
    schemaVersion: 1,
    bundleId: options.bundleId ?? randomUUID(),
    createdAt: (options.now ?? new Date()).toISOString(),
    sourceRootHash: options.sourceRootHash,
    gitCommit: options.gitCommit,
    backupId: options.backupId ?? null,
    files: ordered.map((file) => ({ path: file.path, size: file.content.length, sha256: sha256(file.content), category: file.category })),
    fileCount: ordered.length,
    totalBytes: ordered.reduce((sum, file) => sum + file.content.length, 0),
  });
  const zip = new yazl.ZipFile();
  const archiveFiles = [
    { path: "manifest.json", content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8") },
    ...ordered,
  ].sort((left, right) => left.path.localeCompare(right.path, "en"));
  for (const file of archiveFiles) zip.addBuffer(file.content, `${MIGRATION_ROOT}/${file.path}`, { mtime: new Date("1980-01-01T00:00:00.000Z"), mode: 0o100600 });
  zip.end();
  const chunks: Buffer[] = [];
  const archive = await new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once("error", reject);
    zip.outputStream.once("end", () => resolve(Buffer.concat(chunks)));
  });
  await parseMigrationArchive(archive);
  return { archive, manifest };
}

export async function parseMigrationArchive(buffer: Buffer): Promise<{ manifest: MigrationManifest; files: Map<string, Buffer> }> {
  if (buffer.length > PORTABILITY_LIMITS.maxBackupBytes) throw new Error("Archive de migration trop volumineuse.");
  const zip = await openZip(buffer);
  const raw = new Map<string, Buffer>();
  let entries = 0;
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    const fail = (error: unknown) => { zip.close(); reject(error); };
    zip.once("error", fail);
    zip.once("end", resolve);
    zip.on("entry", async (entry: Entry) => {
      try {
        entries += 1;
        if (entries > PORTABILITY_LIMITS.maxBackupEntries + 1) throw new Error("Trop d’entrées dans le bundle de migration.");
        if ((entry.generalPurposeBitFlag & 0x1) !== 0 || isSymlink(entry)) throw new Error("Archive chiffrée ou lien symbolique interdit.");
        if (entry.fileName.endsWith("/")) throw new Error("Entrée dossier inattendue dans le bundle de migration.");
        const relative = validateMigrationArchiveEntryName(entry.fileName);
        const key = windowsPathKey(relative);
        if (raw.has(key)) throw new Error("Entrée dupliquée ou collision de casse dans le bundle.");
        total += entry.uncompressedSize;
        if (total > PORTABILITY_LIMITS.maxBackupBytes || entry.uncompressedSize > PORTABILITY_LIMITS.maxFileBytes) throw new Error("Limite de décompression du bundle dépassée.");
        raw.set(key, await readEntry(zip, entry));
        zip.readEntry();
      } catch (error) { fail(error); }
    });
    zip.readEntry();
  });
  const manifestBuffer = raw.get("manifest.json");
  if (!manifestBuffer) throw new Error("manifest.json est absent du bundle de migration.");
  let manifest: MigrationManifest;
  try { manifest = migrationManifestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBuffer))); }
  catch (error) { throw new Error("Manifest de migration invalide.", { cause: error }); }
  if (manifest.fileCount !== manifest.files.length || manifest.totalBytes !== manifest.files.reduce((sum, file) => sum + file.size, 0)) throw new Error("Totaux du manifest de migration incohérents.");
  const expected = new Set(["manifest.json"]);
  const files = new Map<string, Buffer>();
  for (const item of manifest.files) {
    const safePath = assertRelativeSafePath(item.path);
    const key = windowsPathKey(safePath);
    const content = raw.get(key);
    if (!content || content.length !== item.size || sha256(content) !== item.sha256) throw new Error(`Checksum de migration invalide : ${safePath}`);
    expected.add(key);
    files.set(safePath, content);
  }
  for (const key of raw.keys()) if (!expected.has(key)) throw new Error(`Entrée inattendue dans le bundle : ${key}`);
  return { manifest, files };
}
