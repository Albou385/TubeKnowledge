import type { LibraryEnvironment } from "@/lib/config/library-config";
import { parseImportZip } from "@/lib/imports/archive";
import { sha256 } from "@/lib/imports/hash";
import { previewImport } from "@/lib/imports/preview";
import type { ImportPreview } from "@/lib/imports/types";

import { CHATGPT_PACKAGE_LIMITS } from "./constants";
import { inspectResultArchive } from "./result-archive";
import { ResultUploadError } from "./result-errors";
import { snapshotContextFile } from "./context";
import { loadStoredPackage, storeResultZip, updatePackageStatus } from "./runtime";

export interface ResultPrevalidation { preview: ImportPreview; warnings: string[]; resultSha256: string }

function normalizedUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  return url.toString();
}

export async function assertPackageFresh(packageId: string, environment: LibraryEnvironment = process.env, runtimeRoot?: string): Promise<void> {
  const stored = await loadStoredPackage(packageId, runtimeRoot);
  for (const [relativePath, expectedHash] of Object.entries(stored.preview.snapshot)) {
    const current = await snapshotContextFile(relativePath, environment);
    if (current.sha256 !== expectedHash) throw new Error(`Le Paquet ChatGPT est périmé : ${relativePath} a changé.`);
  }
}

export async function prevalidateChatGptResult(packageId: string, zip: Buffer, options: { environment?: LibraryEnvironment; sessionRoot?: string; runtimeRoot?: string } = {}): Promise<ResultPrevalidation> {
  if (zip.length > CHATGPT_PACKAGE_LIMITS.maxUploadBytes) throw new ResultUploadError("ARCHIVE_TOO_LARGE");
  const environment = options.environment ?? process.env;
  const stored = await loadStoredPackage(packageId, options.runtimeRoot);
  if (stored.status.status === "imported") throw new ResultUploadError("ALREADY_IMPORTED");
  const resultHash = sha256(zip);
  try {
    let envelope;
    try { envelope = await inspectResultArchive(zip); }
    catch (error) { throw new ResultUploadError(error instanceof Error && error.message === "ARCHIVE_TOO_LARGE" ? "ARCHIVE_TOO_LARGE" : "CORRUPT_ARCHIVE", { cause: error }); }
    if (envelope.kind === "analysis-request") throw new ResultUploadError("SOURCE_PACKAGE_SELECTED");
    if (envelope.kind === "unknown") throw new ResultUploadError("NO_MANIFEST");
    if (envelope.kind === "ambiguous") throw new ResultUploadError("AMBIGUOUS_ARCHIVE");
    try { await assertPackageFresh(packageId, environment, options.runtimeRoot); }
    catch (error) { throw new ResultUploadError("STALE_RESULT", { cause: error }); }
    let parsed: Awaited<ReturnType<typeof parseImportZip>>;
    try { parsed = await parseImportZip(zip); }
    catch (error) { throw new ResultUploadError("UNSUPPORTED_PHASE3", { cause: error }); }
    if (parsed.manifest.packageId !== stored.manifest.packageId) throw new ResultUploadError("PACKAGE_ID_MISMATCH");
    if (normalizedUrl(parsed.manifest.source.url) !== normalizedUrl(stored.manifest.source.url)) throw new ResultUploadError("SOURCE_URL_MISMATCH");
    const warnings: string[] = [];
    if (parsed.manifest.source.title.trim().toLocaleLowerCase("fr") !== stored.manifest.source.title.trim().toLocaleLowerCase("fr")) warnings.push("Le titre source diffère légèrement; vérifiez-le avant l’ajout.");
    const replaceAllowed = new Set(stored.manifest.writeScope.replaceFiles);
    const createPrefixes = stored.manifest.writeScope.createPrefixes;
    for (const operation of parsed.manifest.operations) {
      if (operation.type === "create") {
        if (!createPrefixes.some((prefix) => operation.path.startsWith(prefix))) throw new ResultUploadError("UNSUPPORTED_PHASE3");
      } else {
        if (!replaceAllowed.has(operation.path)) throw new ResultUploadError("UNSUPPORTED_PHASE3");
        const expected = stored.preview.snapshot[operation.path];
        if (!expected || operation.expectedSha256.toLowerCase() !== expected) throw new ResultUploadError("STALE_RESULT");
      }
    }
    const structuralTargets = parsed.manifest.operations.filter((operation) => operation.path === "INDEX.md" || operation.path === "00_SYSTEME/TAXONOMY.md");
    if (structuralTargets.length && parsed.manifest.structuralChange.level !== "major") throw new ResultUploadError("UNSUPPORTED_PHASE3");
    if (parsed.manifest.structuralChange.level === "major" && !parsed.manifest.structuralChange.confirmationRequired) throw new ResultUploadError("UNSUPPORTED_PHASE3");
    await storeResultZip(packageId, zip, resultHash, options.runtimeRoot);
    const preview = await previewImport(zip, { environment, sessionRoot: options.sessionRoot, origin: { type: "chatgpt-package", packageId, runtimeRoot: options.runtimeRoot } });
    await updatePackageStatus(packageId, "result-previewed", { event: "result-previewed", resultSha256: resultHash }, options.runtimeRoot);
    return { preview, warnings, resultSha256: resultHash };
  } catch (error) {
    const message = error instanceof ResultUploadError ? error.publicMessage : "Vérification du résultat impossible.";
    await updatePackageStatus(packageId, "rejected", { event: "result-rejected", resultSha256: resultHash, lastError: message }, options.runtimeRoot);
    throw error;
  }
}
