import yauzl, { type Entry, type ZipFile } from "yauzl";

import { CHATGPT_PACKAGE_LIMITS, CHATGPT_PACKAGE_ROOT } from "./constants";
import { IMPORT_LIMITS, IMPORT_ROOT } from "@/lib/imports/constants";

export type ResultArchiveKind = "phase3-result" | "analysis-request" | "ambiguous" | "unknown";

function openZip(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => error || !zip ? reject(error ?? new Error("Archive ZIP illisible.")) : resolve(zip)));
}

function isSymlink(entry: Entry): boolean {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (mode & 0o170000) === 0o120000;
}

export async function inspectResultArchive(buffer: Buffer): Promise<{ kind: ResultArchiveKind; entries: number }> {
  if (buffer.length > CHATGPT_PACKAGE_LIMITS.maxUploadBytes) throw new Error("ARCHIVE_TOO_LARGE");
  const zip = await openZip(buffer);
  let entries = 0;
  let uncompressedBytes = 0;
  let hasResultManifest = false;
  let hasRequestManifest = false;
  await new Promise<void>((resolve, reject) => {
    const fail = (error: unknown) => { zip.close(); reject(error); };
    zip.once("error", fail);
    zip.once("end", resolve);
    zip.on("entry", (entry: Entry) => {
      try {
        entries += 1;
        if (entries > IMPORT_LIMITS.maxEntries) throw new Error("ARCHIVE_TOO_LARGE");
        if ((entry.generalPurposeBitFlag & 0x1) !== 0 || isSymlink(entry)) throw new Error("ARCHIVE_UNSUPPORTED");
        const name = entry.fileName;
        if (name.includes("\\") || name.includes("\0") || name.startsWith("/") || /^[a-z]:/i.test(name) || name.split("/").includes("..")) throw new Error("ARCHIVE_UNSUPPORTED");
        uncompressedBytes += entry.uncompressedSize;
        if (entry.uncompressedSize > IMPORT_LIMITS.maxMarkdownBytes || uncompressedBytes > IMPORT_LIMITS.maxUncompressedBytes) throw new Error("ARCHIVE_TOO_LARGE");
        if (name === "manifest.json" || name === `${IMPORT_ROOT}/manifest.json`) hasResultManifest = true;
        if (name === "package-manifest.json" || name === `${CHATGPT_PACKAGE_ROOT}/package-manifest.json`) hasRequestManifest = true;
        zip.readEntry();
      } catch (error) { fail(error); }
    });
    zip.readEntry();
  });
  const kind: ResultArchiveKind = hasResultManifest && hasRequestManifest ? "ambiguous" : hasResultManifest ? "phase3-result" : hasRequestManifest ? "analysis-request" : "unknown";
  return { kind, entries };
}
