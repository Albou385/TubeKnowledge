import yauzl, { type Entry, type ZipFile } from "yauzl";
import yazl from "yazl";

import { PORTABILITY_LIMITS } from "./constants";
import { assertRelativeSafePath } from "./filesystem";

export const BACKUP_ROOT = "tubeknowledge-backup";
export interface BackupZipFile { path: string; content: Buffer }

function openZip(buffer: Buffer): Promise<ZipFile> { return new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => error || !zip ? reject(error || new Error("ZIP invalide.")) : resolve(zip))); }
function readEntry(zip: ZipFile, entry: Entry): Promise<Buffer> { return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => { if (error || !stream) return reject(error || new Error("Entrée ZIP illisible.")); const chunks: Buffer[] = []; stream.on("data", (chunk: Buffer) => chunks.push(chunk)); stream.once("error", reject); stream.once("end", () => resolve(Buffer.concat(chunks))); })); }
function isSymlink(entry: Entry): boolean { const mode = (entry.externalFileAttributes >>> 16) & 0xffff; return (mode & 0o170000) === 0o120000; }

export async function createBackupZip(files: BackupZipFile[]): Promise<Buffer> {
  const ordered = [...files].sort((a, b) => a.path.localeCompare(b.path, "en")); const seen = new Set<string>(); let total = 0; const zip = new yazl.ZipFile();
  for (const file of ordered) {
    const relative = assertRelativeSafePath(file.path); const archivePath = `${BACKUP_ROOT}/${relative}`; const key = archivePath.toLocaleLowerCase("en-US");
    if (seen.has(key)) throw new Error(`Collision d’entrée ZIP : ${archivePath}`); seen.add(key); total += file.content.length;
    if (seen.size > PORTABILITY_LIMITS.maxBackupEntries || total > PORTABILITY_LIMITS.maxBackupBytes || file.content.length > PORTABILITY_LIMITS.maxFileBytes) throw new Error("Limite du backup dépassée.");
    zip.addBuffer(file.content, archivePath, { mtime: new Date("1980-01-01T00:00:00Z"), mode: 0o100600 });
  }
  zip.end(); const chunks: Buffer[] = []; const buffer = await new Promise<Buffer>((resolve, reject) => { zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk)); zip.outputStream.once("error", reject); zip.outputStream.once("end", () => resolve(Buffer.concat(chunks))); });
  if (buffer.length > PORTABILITY_LIMITS.maxBackupBytes) throw new Error("Le ZIP dépasse 2 GiB."); await readBackupZip(buffer); return buffer;
}

export async function readBackupZip(buffer: Buffer): Promise<Map<string, Buffer>> {
  if (buffer.length > PORTABILITY_LIMITS.maxBackupBytes) throw new Error("Le ZIP dépasse 2 GiB."); const zip = await openZip(buffer); const files = new Map<string, Buffer>(); let total = 0; let previous = "";
  await new Promise<void>((resolve, reject) => {
    const fail = (error: unknown) => { zip.close(); reject(error); }; zip.once("error", fail); zip.once("end", resolve);
    zip.on("entry", async (entry: Entry) => { try {
      if ((entry.generalPurposeBitFlag & 1) !== 0 || isSymlink(entry)) throw new Error("ZIP chiffré ou lien symbolique interdit.");
      if (entry.fileName.includes("\\") || entry.fileName.includes("\0") || entry.fileName.startsWith("/") || entry.fileName.split("/").includes("..")) throw new Error("Zip Slip interdit.");
      const prefix = `${BACKUP_ROOT}/`; if (!entry.fileName.startsWith(prefix) || entry.fileName === prefix) throw new Error("Le ZIP doit avoir une racine unique tubeknowledge-backup/.");
      if (entry.fileName.endsWith("/")) { zip.readEntry(); return; }
      if (entry.fileName.localeCompare(previous, "en") < 0) throw new Error("Ordre ZIP non déterministe."); previous = entry.fileName;
      const relative = assertRelativeSafePath(entry.fileName.slice(prefix.length)); const key = relative.toLocaleLowerCase("en-US"); if (files.has(key)) throw new Error("Entrée ZIP dupliquée ou collision de casse.");
      total += entry.uncompressedSize; if (files.size >= PORTABILITY_LIMITS.maxBackupEntries || total > PORTABILITY_LIMITS.maxBackupBytes || entry.uncompressedSize > PORTABILITY_LIMITS.maxFileBytes) throw new Error("Limite de décompression dépassée.");
      files.set(key, await readEntry(zip, entry)); zip.readEntry();
    } catch (error) { fail(error); } }); zip.readEntry();
  }); return files;
}

