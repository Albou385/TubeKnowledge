import { constants } from "node:fs";
import { access, lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  parseLibraryConfig,
  type LibraryEnvironment,
} from "@/lib/config/library-config";
import {
  isInsideRoot,
  normalizeRelativeMarkdownPath,
  resolveInsideLibrary,
  UnsafeLibraryPathError,
} from "@/lib/library/path-security";
import type {
  LibraryNode,
  LibrarySnapshot,
  MarkdownDocument,
} from "@/lib/library/types";
import {
  countWords,
  extractHeadings,
  getMainSection,
} from "@/lib/markdown/document-analysis";

const IGNORED_NAMES = new Set([".obsidian", ".git", ".backups", "node_modules"]);

export function isIgnoredEntry(name: string): boolean {
  return name.startsWith(".") || IGNORED_NAMES.has(name);
}

function compareNodes(left: LibraryNode, right: LibraryNode): number {
  if (left.type !== right.type) {
    return left.type === "directory" ? -1 : 1;
  }
  return left.name.localeCompare(right.name, "fr", { sensitivity: "base" });
}

export async function buildLibraryTree(
  rootPath: string,
  currentPath = rootPath,
): Promise<LibraryNode[]> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const nodes: LibraryNode[] = [];

  for (const entry of entries) {
    if (isIgnoredEntry(entry.name) || entry.isSymbolicLink()) {
      continue;
    }

    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join("/");

    if (entry.isDirectory()) {
      nodes.push({
        type: "directory",
        name: entry.name,
        relativePath,
        children: await buildLibraryTree(rootPath, absolutePath),
      });
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
      nodes.push({ type: "file", name: entry.name, relativePath });
    }
  }

  return nodes.sort(compareNodes);
}

function countMarkdownFiles(nodes: LibraryNode[]): number {
  return nodes.reduce(
    (total, node) =>
      total + (node.type === "file" ? 1 : countMarkdownFiles(node.children)),
    0,
  );
}

export async function inspectLibrary(
  environment: LibraryEnvironment = process.env,
): Promise<LibrarySnapshot> {
  const config = parseLibraryConfig(environment);
  if (!config.ok) {
    return {
      available: false,
      configValid: false,
      accessible: false,
      indexPresent: false,
      message: config.message,
    };
  }

  try {
    const rootStats = await stat(config.rootPath);
    if (!rootStats.isDirectory()) {
      return {
        available: false,
        configValid: true,
        accessible: false,
        indexPresent: false,
        message: "Le chemin configuré n’est pas un dossier.",
      };
    }
    await access(config.rootPath, constants.R_OK);
  } catch {
    return {
      available: false,
      configValid: true,
      accessible: false,
      indexPresent: false,
      message: "La bibliothèque configurée est introuvable ou illisible.",
    };
  }

  const indexPath = path.join(config.rootPath, "INDEX.md");
  try {
    const indexStats = await lstat(indexPath);
    if (!indexStats.isFile() || indexStats.isSymbolicLink()) {
      throw new Error("Index invalide");
    }
    await access(indexPath, constants.R_OK);
  } catch {
    return {
      available: false,
      configValid: true,
      accessible: true,
      indexPresent: false,
      message: "INDEX.md est absent ou illisible à la racine de la bibliothèque.",
    };
  }

  try {
    const tree = await buildLibraryTree(config.rootPath);
    return {
      available: true,
      configValid: true,
      accessible: true,
      indexPresent: true,
      libraryName: path.basename(path.resolve(config.rootPath)),
      tree,
      stats: {
        topLevelSections: tree.filter((node) => node.type === "directory").length,
        markdownFiles: countMarkdownFiles(tree),
      },
    };
  } catch {
    return {
      available: false,
      configValid: true,
      accessible: false,
      indexPresent: true,
      message: "La bibliothèque existe, mais son arborescence ne peut pas être lue.",
    };
  }
}

export async function readMarkdownDocument(
  requestedPath: string,
  environment: LibraryEnvironment = process.env,
): Promise<MarkdownDocument> {
  const config = parseLibraryConfig(environment);
  if (!config.ok) {
    throw new Error(config.message);
  }

  const relativePath = normalizeRelativeMarkdownPath(requestedPath);
  const targetPath = resolveInsideLibrary(config.rootPath, relativePath);
  const targetStats = await lstat(targetPath);

  if (!targetStats.isFile() || targetStats.isSymbolicLink()) {
    throw new UnsafeLibraryPathError("Le fichier demandé n’est pas un fichier Markdown lisible.");
  }

  const [realRootPath, realTargetPath] = await Promise.all([
    realpath(config.rootPath),
    realpath(targetPath),
  ]);
  if (!isInsideRoot(realRootPath, realTargetPath)) {
    throw new UnsafeLibraryPathError("Le fichier demandé sort de la bibliothèque.");
  }

  const [content, fileStats] = await Promise.all([
    readFile(realTargetPath, "utf8"),
    stat(realTargetPath),
  ]);
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();

  return {
    content,
    relativePath,
    title: heading || path.posix.basename(relativePath, ".md"),
    lastModified: fileStats.mtime.toISOString(),
    wordCount: countWords(content),
    section: getMainSection(relativePath),
    headings: extractHeadings(content),
  };
}
