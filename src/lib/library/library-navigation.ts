import path from "node:path";

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { readMarkdownDocument } from "@/lib/library/library-reader";
import type { LibraryNode } from "@/lib/library/types";

const KNOWLEDGE_ROOT = "01_BIBLIOTHEQUE";

export interface LibraryNotionNavigation {
  title: string;
  relativePath: string;
  summary: string | null;
  sourceCount: number | null;
  relatedNotions: Array<{ title: string; relativePath: string }>;
}

export interface LibrarySubjectNavigation {
  name: string;
  relativePath: string;
  notions: LibraryNotionNavigation[];
}

export interface LibraryDomainNavigation {
  name: string;
  relativePath: string;
  subjects: LibrarySubjectNavigation[];
  directNotions: LibraryNotionNavigation[];
}

interface NotionDraft {
  title: string;
  relativePath: string;
  content: string;
}

function documentsBelow(nodes: LibraryNode[]): string[] {
  return nodes.flatMap((node) => node.type === "file"
    ? (node.name.toLocaleLowerCase("fr") === "index.md" ? [] : [node.relativePath])
    : documentsBelow(node.children));
}

function firstParagraph(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => /^#\s+\S/.test(line));
  const body = lines.slice(titleIndex >= 0 ? titleIndex + 1 : 0);
  const paragraph: string[] = [];
  for (const line of body) {
    const trimmed = line.trim();
    if (/^#{1,6}\s/.test(trimmed)) break;
    if (!trimmed) {
      if (paragraph.length > 0) break;
      continue;
    }
    if (/^(?:[-*+]\s|\d+[.)]\s|>|```|~~~|\|)/.test(trimmed)) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(trimmed);
  }
  const value = paragraph.join(" ")
    .replace(/!?(?:\[([^\]]*)\]\([^)]*\))/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => label ?? target)
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return null;
  return value.length > 220 ? `${value.slice(0, 217).trimEnd()}…` : value;
}

function sourceCount(markdown: string): number | null {
  const heading = markdown.match(/^##\s+Sources?\s+vid[ée]o(?:s)?\s*#*\s*$/imu);
  if (!heading || heading.index === undefined) return null;
  const section = markdown.slice(heading.index + heading[0].length).split(/^##\s+/mu, 1)[0];
  const urls = [...section.matchAll(/https?:\/\/[^\s)<]+/giu)].map((match) => match[0].replace(/[.,;:]+$/u, "").toLocaleLowerCase("en"));
  return new Set(urls).size;
}

function relativeLinkTarget(rawTarget: string, from: string): string | null {
  const target = rawTarget.trim().replace(/^<|>$/g, "").split("#", 1)[0];
  if (!target || /^(?:https?:|mailto:|\/)/iu.test(target)) return null;
  const withExtension = path.posix.extname(target) ? target : `${target}.md`;
  const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(from), withExtension));
  return normalized.startsWith("../") || normalized === ".." ? null : normalized;
}

function explicitLinks(markdown: string, from: string, knownPaths: Set<string>): string[] {
  const targets = new Set<string>();
  for (const match of markdown.matchAll(/(?<!!)\[\[([^\]|#]+)(?:#[^|\]]*)?(?:\|[^\]]*)?\]\]/gu)) {
    const target = relativeLinkTarget(match[1], from);
    if (target && knownPaths.has(target)) targets.add(target);
  }
  for (const match of markdown.matchAll(/(?<!!)\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/gu)) {
    const target = relativeLinkTarget(match[1], from);
    if (target && knownPaths.has(target)) targets.add(target);
  }
  return [...targets];
}

export async function getLibraryNavigation(
  tree: LibraryNode[],
  environment: LibraryEnvironment = process.env,
): Promise<LibraryDomainNavigation[]> {
  const knowledge = tree.find((node): node is Extract<LibraryNode, { type: "directory" }> => node.type === "directory" && node.relativePath === KNOWLEDGE_ROOT);
  if (!knowledge) return [];

  const structure = knowledge.children
    .filter((node): node is Extract<LibraryNode, { type: "directory" }> => node.type === "directory")
    .map((domain) => ({
      domain,
      subjects: domain.children.filter((node): node is Extract<LibraryNode, { type: "directory" }> => node.type === "directory"),
      directPaths: domain.children.filter((node) => node.type === "file" && node.name.toLocaleLowerCase("fr") !== "index.md").map((node) => node.relativePath),
    }));
  const paths = structure.flatMap(({ subjects, directPaths }) => [...directPaths, ...subjects.flatMap((subject) => documentsBelow(subject.children))]);
  const documents = await Promise.all(paths.map(async (relativePath) => {
    const document = await readMarkdownDocument(relativePath, environment);
    return { title: document.title, relativePath: document.relativePath, content: document.content } satisfies NotionDraft;
  }));
  const byPath = new Map(documents.map((document) => [document.relativePath, document]));
  const knownPaths = new Set(byPath.keys());
  const connected = new Map<string, Set<string>>(documents.map((document) => [document.relativePath, new Set<string>()]));
  for (const document of documents) {
    for (const target of explicitLinks(document.content, document.relativePath, knownPaths)) {
      connected.get(document.relativePath)?.add(target);
      connected.get(target)?.add(document.relativePath);
    }
  }
  const notion = (relativePath: string): LibraryNotionNavigation => {
    const document = byPath.get(relativePath);
    if (!document) throw new Error("Notion absente de la navigation.");
    return {
      title: document.title,
      relativePath,
      summary: firstParagraph(document.content),
      sourceCount: sourceCount(document.content),
      relatedNotions: [...(connected.get(relativePath) ?? [])]
        .map((target) => byPath.get(target))
        .filter((target): target is NotionDraft => Boolean(target))
        .sort((left, right) => left.title.localeCompare(right.title, "fr"))
        .map((target) => ({ title: target.title, relativePath: target.relativePath })),
    };
  };

  return structure.map(({ domain, subjects, directPaths }) => ({
    name: domain.name,
    relativePath: domain.relativePath,
    directNotions: directPaths.map(notion),
    subjects: subjects.map((subject) => ({
      name: subject.name,
      relativePath: subject.relativePath,
      notions: documentsBelow(subject.children).map(notion),
    })),
  }));
}
