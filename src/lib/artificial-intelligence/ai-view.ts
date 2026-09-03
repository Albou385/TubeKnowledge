import type { LibraryEnvironment } from "@/lib/config/library-config";
import { inspectLibrary, readMarkdownDocument } from "@/lib/library/library-reader";
import type { LibraryNode } from "@/lib/library/types";

export const AI_SECTION_PATH = "01_BIBLIOTHEQUE/Intelligence-artificielle";

export interface AiDocumentSummary {
  title: string;
  relativePath: string;
  lastModified: string;
}

export interface AiSectionView {
  index: AiDocumentSummary | null;
  subsections: Array<{ name: string; relativePath: string; documentCount: number }>;
  notions: AiDocumentSummary[];
  recentDocuments: AiDocumentSummary[];
}

function countFiles(nodes: LibraryNode[]): number {
  return nodes.reduce((total, node) => total + (node.type === "file" ? 1 : countFiles(node.children)), 0);
}

function collectFiles(nodes: LibraryNode[]): string[] {
  return nodes.flatMap((node) => node.type === "file" ? [node.relativePath] : collectFiles(node.children));
}

export async function getArtificialIntelligenceView(
  environment: LibraryEnvironment = process.env,
): Promise<AiSectionView> {
  const library = await inspectLibrary(environment);
  if (!library.available) throw new Error("La bibliothèque n’est pas disponible.");

  const topLevel = library.tree.find(
    (node) => node.type === "directory" && node.relativePath === "01_BIBLIOTHEQUE",
  );
  const section = topLevel?.type === "directory"
    ? topLevel.children.find((node) => node.type === "directory" && node.relativePath === AI_SECTION_PATH)
    : undefined;

  if (!section || section.type !== "directory") {
    return { index: null, subsections: [], notions: [], recentDocuments: [] };
  }

  const paths = collectFiles(section.children);
  const documents = await Promise.all(paths.map(async (relativePath) => {
    const document = await readMarkdownDocument(relativePath, environment);
    return {
      title: document.title,
      relativePath: document.relativePath,
      lastModified: document.lastModified,
    };
  }));
  const index = documents.find((document) => document.relativePath === `${AI_SECTION_PATH}/INDEX.md`) ?? null;
  const notions = documents.filter((document) => document !== index);

  return {
    index,
    subsections: section.children
      .filter((node): node is Extract<LibraryNode, { type: "directory" }> => node.type === "directory")
      .map((node) => ({ name: node.name, relativePath: node.relativePath, documentCount: countFiles(node.children) })),
    notions,
    recentDocuments: [...documents]
      .sort((left, right) => right.lastModified.localeCompare(left.lastModified))
      .slice(0, 5),
  };
}
