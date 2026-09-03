import path from "node:path";

import type { ImportManifest, ImportOperation } from "@/lib/imports/schema";
import { UnsafeLibraryPathError } from "@/lib/library/path-security";

const ABSOLUTE_WINDOWS = /^[a-zA-Z]:[\\/]/;

export function normalizeImportPath(input: string): string {
  if (!input || input.includes("\0") || input.includes("\\") || path.posix.isAbsolute(input) || ABSOLUTE_WINDOWS.test(input) || input.startsWith("//")) {
    throw new UnsafeLibraryPathError("Chemin d’import absolu ou invalide.");
  }
  const segments = input.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new UnsafeLibraryPathError("Segments de chemin interdits.");
  }
  const normalized = segments.join("/");
  if (path.posix.extname(normalized).toLowerCase() !== ".md") {
    throw new UnsafeLibraryPathError("Seuls les fichiers Markdown sont importables.");
  }
  return normalized;
}

export function isAllowedImportTarget(relativePath: string): boolean {
  const value = normalizeImportPath(relativePath);
  return value === "INDEX.md"
    || value === "00_SYSTEME/TAXONOMY.md"
    || value === "00_SYSTEME/CHANGELOG.md"
    || value === "02_SOURCES/videos.md"
    || value.startsWith("01_BIBLIOTHEQUE/");
}

export function validateManifestPaths(manifest: ImportManifest): void {
  const targets = new Set<string>();
  const contents = new Set<string>();
  for (const operation of manifest.operations) {
    const target = normalizeImportPath(operation.path);
    if (!isAllowedImportTarget(target)) throw new UnsafeLibraryPathError(`Cible non autorisée : ${target}`);
    const expectedContent = `changes/${operation.type}/${target}`;
    if (operation.contentFile !== expectedContent) throw new UnsafeLibraryPathError(`contentFile incohérent pour ${target}.`);
    const targetKey = target.toLocaleLowerCase("en-US");
    const contentKey = operation.contentFile.toLocaleLowerCase("en-US");
    if (targets.has(targetKey)) throw new UnsafeLibraryPathError(`Opération dupliquée ou collision de casse : ${target}`);
    if (contents.has(contentKey)) throw new UnsafeLibraryPathError(`Fichier de contenu dupliqué : ${operation.contentFile}`);
    targets.add(targetKey);
    contents.add(contentKey);
  }
}

export function expectedContentFiles(operations: ImportOperation[]): Set<string> {
  return new Set(operations.map((operation) => operation.contentFile));
}
