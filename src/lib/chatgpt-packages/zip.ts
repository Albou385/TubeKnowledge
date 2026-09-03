import yauzl, { type Entry, type ZipFile } from "yauzl";
import yazl from "yazl";

import { CHATGPT_PACKAGE_LIMITS, CHATGPT_PACKAGE_ROOT } from "./constants";

export interface PackageFile { path: string; content: string | Buffer }
export interface ValidatedPackageZip { entries: string[]; uncompressedBytes: number; zipBytes: number }

function validateArchivePath(name: string): void {
  if (name.includes("\\") || name.includes("\0") || name.startsWith("/") || /^[a-z]:/i.test(name) || name.split("/").includes("..")) throw new Error("Chemin ZIP absolu ou traversal interdit.");
  if (name.split("/").some((part) => part.startsWith("."))) throw new Error("Les fichiers cachés sont interdits dans le Paquet ChatGPT.");
}

export async function createStablePackageZip(files: PackageFile[]): Promise<Buffer> {
  const ordered = [...files].sort((a, b) => a.path.localeCompare(b.path, "en"));
  const seen = new Set<string>();
  let uncompressed = 0;
  const zip = new yazl.ZipFile();
  for (const file of ordered) {
    validateArchivePath(file.path);
    const archivePath = `${CHATGPT_PACKAGE_ROOT}/${file.path}`;
    if (seen.has(archivePath)) throw new Error(`Entrée ZIP dupliquée : ${archivePath}`);
    seen.add(archivePath);
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, "utf8");
    uncompressed += content.length;
    if (seen.size > CHATGPT_PACKAGE_LIMITS.maxEntries) throw new Error("Le paquet contient trop d’entrées.");
    if (uncompressed > CHATGPT_PACKAGE_LIMITS.maxUncompressedBytes) throw new Error("Le paquet dépasse la limite non compressée de 50 MiB.");
    zip.addBuffer(content, archivePath, { mtime: new Date("1980-01-01T00:00:00.000Z"), mode: 0o100600 });
  }
  zip.end();
  const chunks: Buffer[] = [];
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once("error", reject);
    zip.outputStream.once("end", () => resolve(Buffer.concat(chunks)));
  });
  if (buffer.length > CHATGPT_PACKAGE_LIMITS.maxZipBytes) throw new Error("Le ZIP dépasse la limite de 25 MiB.");
  await validatePackageZip(buffer);
  return buffer;
}

function openZip(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => error || !zip ? reject(error ?? new Error("ZIP invalide.")) : resolve(zip)));
}

function isSymlink(entry: Entry): boolean {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (mode & 0o170000) === 0o120000;
}

export async function validatePackageZip(buffer: Buffer): Promise<ValidatedPackageZip> {
  if (buffer.length > CHATGPT_PACKAGE_LIMITS.maxZipBytes) throw new Error("Le ZIP dépasse la limite de 25 MiB.");
  const zip = await openZip(buffer);
  const entries: string[] = [];
  let uncompressedBytes = 0;
  await new Promise<void>((resolve, reject) => {
    const fail = (error: unknown) => { zip.close(); reject(error); };
    zip.once("error", fail);
    zip.once("end", resolve);
    zip.on("entry", (entry: Entry) => {
      try {
        if (entries.length >= CHATGPT_PACKAGE_LIMITS.maxEntries) throw new Error("Le paquet contient trop d’entrées.");
        if ((entry.generalPurposeBitFlag & 0x1) !== 0) throw new Error("ZIP chiffré interdit.");
        if (isSymlink(entry)) throw new Error("Lien symbolique ZIP interdit.");
        validateArchivePath(entry.fileName);
        const parts = entry.fileName.split("/");
        if (parts[0] !== CHATGPT_PACKAGE_ROOT || parts.length < 2) throw new Error("Le ZIP doit contenir une seule racine tubeknowledge-chatgpt-package/.");
        if (!entry.fileName.endsWith("/")) {
          entries.push(entry.fileName);
          uncompressedBytes += entry.uncompressedSize;
          if (uncompressedBytes > CHATGPT_PACKAGE_LIMITS.maxUncompressedBytes) throw new Error("Le paquet dépasse la limite non compressée de 50 MiB.");
        }
        zip.readEntry();
      } catch (error) { fail(error); }
    });
    zip.readEntry();
  });
  const sorted = [...entries].sort((a, b) => a.localeCompare(b, "en"));
  if (entries.some((value, index) => value !== sorted[index])) throw new Error("L’ordre des entrées ZIP n’est pas stable.");
  return { entries, uncompressedBytes, zipBytes: buffer.length };
}
