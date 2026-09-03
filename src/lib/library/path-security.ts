import path from "node:path";

export class UnsafeLibraryPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeLibraryPathError";
  }
}

const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH = /^(?:\\\\|\/\/)/;

export function normalizeRelativeMarkdownPath(input: string): string {
  const normalized = normalizeRelativeLibraryPath(input);
  if (path.posix.extname(normalized).toLowerCase() !== ".md") {
    throw new UnsafeLibraryPathError("Seuls les fichiers Markdown (.md) sont autorisés.");
  }
  return normalized;
}

export function normalizeRelativeLibraryPath(input: string): string {
  if (!input || input.includes("\0")) {
    throw new UnsafeLibraryPathError("Le chemin demandé est vide ou invalide.");
  }

  const slashPath = input.replaceAll("\\", "/");

  if (
    path.posix.isAbsolute(slashPath) ||
    WINDOWS_ABSOLUTE_PATH.test(input) ||
    WINDOWS_UNC_PATH.test(input)
  ) {
    throw new UnsafeLibraryPathError("Les chemins absolus sont interdits.");
  }

  const segments = slashPath.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new UnsafeLibraryPathError("Les segments '..' sont interdits.");
  }

  const normalized = segments.filter((segment) => segment && segment !== ".").join("/");
  if (!normalized) {
    throw new UnsafeLibraryPathError("Le chemin demandé est vide ou invalide.");
  }

  return normalized;
}

export function resolveInsideLibrary(rootPath: string, relativePath: string): string {
  const normalized = normalizeRelativeMarkdownPath(relativePath);
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(resolvedRoot, ...normalized.split("/"));
  const relation = path.relative(resolvedRoot, resolvedTarget);

  if (relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new UnsafeLibraryPathError("Le chemin demandé sort de la bibliothèque.");
  }

  return resolvedTarget;
}

export function isInsideRoot(realRootPath: string, realTargetPath: string): boolean {
  const relation = path.relative(realRootPath, realTargetPath);
  return relation === "" || (!relation.startsWith("..") && !path.isAbsolute(relation));
}
