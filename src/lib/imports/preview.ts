import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { parseImportZip } from "@/lib/imports/archive";
import { createTextDiff } from "@/lib/imports/diff";
import { assertSafeTarget } from "@/lib/imports/filesystem";
import { sha256 } from "@/lib/imports/hash";
import { createImportSession, readImportSession } from "@/lib/imports/sessions";
import type { ImportPreview, PreviewOperation, StoredOperation } from "@/lib/imports/types";

export async function previewImport(zipBuffer: Buffer, options: { environment?: LibraryEnvironment; sessionRoot?: string; now?: Date; origin?: import("@/lib/imports/types").ImportSession["origin"] } = {}): Promise<ImportPreview> {
  const config = parseLibraryConfig(options.environment ?? process.env);
  if (!config.ok) throw new Error(config.message);
  const parsed = await parseImportZip(zipBuffer);
  const previewOperations: PreviewOperation[] = [];
  const storedOperations: StoredOperation[] = [];

  for (const operation of parsed.manifest.operations) {
    const content = parsed.contents.get(operation.contentFile)!;
    const newHash = sha256(content);
    let status: PreviewOperation["status"] = "valid";
    let message = operation.type === "create" ? "Création prête." : "Remplacement prêt.";
    let beforeContent: string | null = null;
    let beforeSha256: string | null = null;
    let beforeSize: number | null = null;
    let beforeMtimeMs: number | null = null;
    const targetPath = await assertSafeTarget(config.rootPath, operation.path, operation.type === "create");
    let exists = true;
    try {
      const stats = await lstat(targetPath);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("Cible non régulière ou symbolique.");
      beforeContent = await readFile(targetPath, "utf8");
      beforeSha256 = sha256(beforeContent);
      beforeSize = stats.size;
      beforeMtimeMs = stats.mtimeMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") exists = false;
      else throw error;
    }
    if (newHash !== operation.newSha256.toLowerCase()) { status = "invalid"; message = "Le hash du nouveau contenu est invalide."; }
    else if (operation.type === "create" && exists) { status = "conflict"; message = "La cible à créer existe déjà."; }
    else if (operation.type === "replace" && !exists) { status = "conflict"; message = "La cible à remplacer est absente."; }
    else if (operation.type === "replace" && beforeSha256 !== operation.expectedSha256.toLowerCase()) { status = "conflict"; message = "Le fichier actuel ne correspond pas au hash attendu."; }
    else if (operation.type === "replace" && beforeSha256 === newHash) { status = "invalid"; message = "Le remplacement ne modifie pas le contenu."; }
    previewOperations.push({ type: operation.type, path: operation.path, status, message, beforeSha256, afterSha256: newHash, diff: createTextDiff(beforeContent ?? "", content) });
    storedOperations.push({ type: operation.type, path: operation.path, content, newSha256: newHash, expectedSha256: operation.type === "replace" ? operation.expectedSha256.toLowerCase() : undefined, beforeContent, beforeSha256, beforeSize, beforeMtimeMs });
  }

  const session = await createImportSession({ rootPath: config.rootPath, manifest: parsed.manifest, operations: storedOperations, origin: options.origin, review: parsed.review }, options.sessionRoot, options.now);
  const canApply = previewOperations.every((operation) => operation.status === "valid");
  return { sessionId: session.id, expiresAt: session.expiresAt, packageId: parsed.manifest.packageId, source: parsed.manifest.source, summary: parsed.manifest.summary, structuralChange: parsed.manifest.structuralChange, review: parsed.review, operations: previewOperations, canApply, sessionStatus: session.status };
}

async function inspectStoredOperation(rootPath: string, operation: StoredOperation): Promise<PreviewOperation> {
  let status: PreviewOperation["status"] = "valid";
  let message = operation.type === "create" ? "Création prête." : "Remplacement prêt.";
  let currentContent = "";
  let currentHash: string | null = null;
  const targetPath = await assertSafeTarget(rootPath, operation.path, operation.type === "create");
  let exists = true;
  try {
    const stats = await lstat(targetPath);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("Cible non régulière ou symbolique.");
    currentContent = await readFile(targetPath, "utf8");
    currentHash = sha256(currentContent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") exists = false;
    else throw error;
  }
  if (sha256(operation.content) !== operation.newSha256) { status = "invalid"; message = "Le nouveau contenu n’est plus valide."; }
  else if (operation.type === "create" && exists) { status = "conflict"; message = "La cible à créer existe maintenant."; }
  else if (operation.type === "replace" && !exists) { status = "conflict"; message = "La cible à remplacer est maintenant absente."; }
  else if (operation.type === "replace" && currentHash !== operation.beforeSha256) { status = "conflict"; message = "Le fichier a changé depuis la prévisualisation."; }
  else if (operation.type === "replace" && currentHash === operation.newSha256) { status = "invalid"; message = "Le remplacement ne modifie plus le contenu."; }
  return { type: operation.type, path: operation.path, status, message, beforeSha256: currentHash, afterSha256: operation.newSha256, diff: createTextDiff(currentContent, operation.content) };
}

export async function resumeImportPreview(sessionId: string, options: { environment?: LibraryEnvironment; sessionRoot?: string; now?: Date } = {}): Promise<ImportPreview> {
  const config = parseLibraryConfig(options.environment ?? process.env);
  if (!config.ok) throw new Error(config.message);
  const session = await readImportSession(sessionId, options.sessionRoot, options.now, false);
  if (path.resolve(session.rootPath) !== path.resolve(config.rootPath)) throw new Error("Le vault configuré a changé.");
  const operations: PreviewOperation[] = [];
  for (const operation of session.operations) operations.push(await inspectStoredOperation(config.rootPath, operation));
  return {
    sessionId: session.id,
    expiresAt: session.expiresAt,
    packageId: session.manifest.packageId,
    source: session.manifest.source,
    summary: session.manifest.summary,
    structuralChange: session.manifest.structuralChange,
    review: session.review ?? "Revue initiale indisponible pour cette ancienne session.",
    operations,
    canApply: session.status === "ready" || (session.status === "failed" && Boolean(session.failure?.retryable) && !session.failure?.requiresNewPreview)
      ? operations.every((operation) => operation.status === "valid")
      : false,
    sessionStatus: session.status,
    failure: session.failure,
    appliedResult: session.result,
  };
}
