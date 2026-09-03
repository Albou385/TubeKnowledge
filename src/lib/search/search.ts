import path from "node:path";
import type { LibraryEnvironment } from "@/lib/config/library-config";
import { buildLibraryTree, readMarkdownDocument } from "@/lib/library/library-reader";
import type { LibraryNode, SearchResult } from "@/lib/library/types";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { parseSearchRequest } from "@/lib/search/search-schema";

export { MAX_SEARCH_QUERY_LENGTH, MAX_SEARCH_RESULTS, parseSearchRequest } from "@/lib/search/search-schema";

function flattenFiles(nodes: LibraryNode[]): string[] {
  return nodes.flatMap((node) =>
    node.type === "file" ? [node.relativePath] : flattenFiles(node.children),
  );
}

function makeExcerpt(content: string, query: string, fallback: string): string {
  const searchable = content.replace(/\s+/g, " ").trim();
  const index = searchable.toLocaleLowerCase("fr").indexOf(query.toLocaleLowerCase("fr"));
  if (index < 0) return fallback;

  const radius = 90;
  const start = Math.max(0, index - radius);
  const end = Math.min(searchable.length, index + query.length + radius);
  return `${start > 0 ? "…" : ""}${searchable.slice(start, end).trim()}${end < searchable.length ? "…" : ""}`;
}

export function generateSearchExcerpt(content: string, query: string, fallback = "Correspondance dans le document."): string {
  return makeExcerpt(content, query, fallback);
}

function scoreDocument(
  query: string,
  title: string,
  relativePath: string,
  content: string,
): number {
  const needle = query.toLocaleLowerCase("fr");
  const fileName = path.posix.basename(relativePath, ".md").toLocaleLowerCase("fr");
  const normalizedTitle = title.toLocaleLowerCase("fr");
  const normalizedPath = relativePath.toLocaleLowerCase("fr");
  const normalizedContent = content.toLocaleLowerCase("fr");
  let score = 0;

  if (fileName === needle) score += 100;
  else if (fileName.includes(needle)) score += 60;
  if (normalizedTitle === needle) score += 90;
  else if (normalizedTitle.includes(needle)) score += 50;
  if (normalizedPath.includes(needle)) score += 30;
  if (normalizedContent.includes(needle)) score += 20;
  return score;
}

export async function searchLibrary(
  rawRequest: unknown,
  environment: LibraryEnvironment = process.env,
): Promise<SearchResult[]> {
  const request = parseSearchRequest(rawRequest);
  const config = parseLibraryConfig(environment);
  if (!config.ok) throw new Error("La bibliothèque n’est pas configurée.");

  const tree = await buildLibraryTree(config.rootPath);
  const results: SearchResult[] = [];

  for (const relativePath of flattenFiles(tree)) {
    const document = await readMarkdownDocument(relativePath, environment);
    const score = scoreDocument(request.q, document.title, relativePath, document.content);
    if (score === 0) continue;
    results.push({
      title: document.title,
      relativePath,
      section: document.section,
      excerpt: generateSearchExcerpt(
        document.content,
        request.q,
        `Correspondance dans ${document.title}.`,
      ),
      score,
    });
  }

  return results
    .sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath, "fr"))
    .slice(0, request.limit);
}
