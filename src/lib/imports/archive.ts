import yauzl, { type Entry, type ZipFile } from "yauzl";

import { IMPORT_LIMITS, IMPORT_ROOT } from "@/lib/imports/constants";
import { decodeUtf8 } from "@/lib/imports/hash";
import { expectedContentFiles, validateManifestPaths } from "@/lib/imports/path-policy";
import { importManifestSchema, type ImportManifest } from "@/lib/imports/schema";

export interface ParsedImportPackage { manifest: ImportManifest; review: string; contents: Map<string, string>; }

function openZip(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => error || !zip ? reject(error ?? new Error("ZIP invalide.")) : resolve(zip)));
}

function readEntry(zip: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => {
    if (error || !stream) return reject(error ?? new Error("Entrée ZIP illisible."));
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

export async function parseImportZip(buffer: Buffer): Promise<ParsedImportPackage> {
  if (buffer.length > IMPORT_LIMITS.maxZipBytes) throw new Error("ZIP trop volumineux.");
  const zip = await openZip(buffer);
  const raw = new Map<string, Buffer>();
  let entries = 0;
  let uncompressed = 0;

  await new Promise<void>((resolve, reject) => {
    const fail = (error: unknown) => { zip.close(); reject(error); };
    zip.once("error", fail);
    zip.once("end", resolve);
    zip.on("entry", async (entry: Entry) => {
      try {
        entries += 1;
        if (entries > IMPORT_LIMITS.maxEntries) throw new Error("Le ZIP contient trop d’entrées.");
        if ((entry.generalPurposeBitFlag & 0x1) !== 0) throw new Error("Les archives chiffrées sont interdites.");
        if (isSymlink(entry)) throw new Error("Les liens symboliques ZIP sont interdits.");
        const name = entry.fileName;
        if (name.includes("\\") || name.includes("\0") || name.startsWith("/") || /^[a-zA-Z]:/.test(name) || name.split("/").includes("..")) throw new Error("Zip Slip ou chemin ZIP invalide.");
        if (name.endsWith("/")) { zip.readEntry(); return; }
        if (/\.zip$/i.test(name)) throw new Error("Les ZIP imbriqués sont interdits.");
        uncompressed += entry.uncompressedSize;
        if (entry.uncompressedSize > IMPORT_LIMITS.maxMarkdownBytes || uncompressed > IMPORT_LIMITS.maxUncompressedBytes) throw new Error("Limite de décompression dépassée.");
        const content = await readEntry(zip, entry);
        if (raw.has(name)) throw new Error(name.endsWith("manifest.json") ? "Plusieurs manifestes sont interdits." : `Entrée ZIP dupliquée : ${name}`);
        raw.set(name, content);
        zip.readEntry();
      } catch (error) { fail(error); }
    });
    zip.readEntry();
  });

  const roots = [...raw.keys()].map((name) => name.split("/")[0]);
  const nested = roots.every((root) => root === IMPORT_ROOT);
  if (!nested && roots.some((root) => root === IMPORT_ROOT)) throw new Error("Racines ZIP ambiguës.");
  const files = new Map<string, Buffer>();
  for (const [name, content] of raw) files.set(nested ? name.slice(IMPORT_ROOT.length + 1) : name, content);
  const manifests = [...files.keys()].filter((name) => name === "manifest.json");
  if (manifests.length !== 1) throw new Error(manifests.length ? "Plusieurs manifestes sont interdits." : "manifest.json est absent.");
  let manifestValue: unknown;
  try { manifestValue = JSON.parse(decodeUtf8(files.get("manifest.json")!)); } catch { throw new Error("manifest.json est invalide ou non UTF-8."); }
  const manifest = importManifestSchema.parse(manifestValue);
  validateManifestPaths(manifest);
  const allowed = new Set(["manifest.json", "REVIEW.md", ...expectedContentFiles(manifest.operations)]);
  for (const name of files.keys()) if (!allowed.has(name)) throw new Error(`Fichier inattendu dans le ZIP : ${name}`);
  if (!files.has("REVIEW.md")) throw new Error("REVIEW.md est absent.");
  const contents = new Map<string, string>();
  for (const operation of manifest.operations) {
    const value = files.get(operation.contentFile);
    if (!value) throw new Error(`Contenu absent : ${operation.contentFile}`);
    contents.set(operation.contentFile, decodeUtf8(value));
  }
  return { manifest, review: decodeUtf8(files.get("REVIEW.md")!), contents };
}
