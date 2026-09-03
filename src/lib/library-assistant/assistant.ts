import path from "node:path";

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { buildLibraryTree, readMarkdownDocument } from "@/lib/library/library-reader";
import type { LibraryNode, MarkdownDocument } from "@/lib/library/types";
import { slugifyHeading } from "@/lib/markdown/document-analysis";

import { libraryQuestionSchema, type LibraryQuestion } from "./schema";

const STOPWORDS = new Set([
  "a", "ai", "au", "aux", "avec", "ce", "ces", "dans", "de", "des", "du", "elle", "en", "et", "est", "il", "je", "la", "le", "les", "ma", "mes", "mon", "ne", "notre", "nous", "ou", "par", "pas", "pour", "que", "qui", "sa", "se", "ses", "sur", "un", "une", "vos", "votre", "vous",
  "about", "and", "are", "can", "compare", "does", "for", "from", "how", "in", "is", "my", "of", "on", "or", "the", "to", "what", "which", "with",
]);

export interface LibraryCitation {
  citationId: string;
  title: string;
  relativePath: string;
  section: string;
  heading?: string;
  anchor?: string;
  lineStart: number;
  excerpt: string;
  score: number;
  videoSource?: string;
}

export interface LibraryAssistantAnswer {
  question: string;
  provider: "extractive" | "mock";
  fixture: boolean;
  answer: string;
  citations: LibraryCitation[];
  documentsUsed: string[];
  uncertainty?: string;
}

function flatten(nodes: LibraryNode[]): string[] {
  return nodes.flatMap((node) => node.type === "file" ? [node.relativePath] : flatten(node.children));
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr");
}

export function significantTerms(question: string): string[] {
  const original = question.match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu) ?? [];
  const terms = original
    .map((value) => ({ value: normalize(value), acronym: /^[A-Z0-9]{2,}$/.test(value) }))
    .filter((term) => term.value.length >= 2 && (!STOPWORDS.has(term.value) || term.acronym))
    .map((term) => term.value);
  return [...new Set(terms)].slice(0, 30);
}

function bestPassage(document: MarkdownDocument, terms: string[]) {
  const lines = document.content.split(/\r?\n/);
  let heading: string | undefined;
  let headingAnchor: string | undefined;
  const headingOccurrences = new Map<string, number>();
  let best = { score: 0, line: 0, heading: undefined as string | undefined, anchor: undefined as string | undefined };
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    const title = match?.[2]?.trim();
    if (title) {
      heading = title;
      const level = match![1].length;
      if (level === 2 || level === 3) {
        const base = slugifyHeading(title);
        const count = (headingOccurrences.get(base) ?? 0) + 1;
        headingOccurrences.set(base, count);
        headingAnchor = count === 1 ? base : `${base}-${count}`;
      } else headingAnchor = undefined;
    }
    const searchable = normalize(lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 3)).join(" "));
    const score = terms.reduce((sum, term) => sum + (searchable.includes(term) ? 1 : 0), 0);
    if (score > best.score) best = { score, line: index, heading, anchor: headingAnchor };
  }
  const start = Math.max(0, best.line - 1);
  const passageLines = lines.slice(start, Math.min(lines.length, start + 6)).map((value, offset) => ({ value, line: start + offset + 1 })).filter((item) => item.value.trim() && !/^#{1,6}\s/.test(item.value));
  const excerpt = passageLines.map((item) => item.value).join(" ").replace(/\s+/g, " ").trim().slice(0, 600);
  return { heading: best.heading, anchor: best.anchor, lineStart: passageLines[0]?.line ?? best.line + 1, excerpt: excerpt || "Document pertinent; ouvrez la source pour consulter le passage." };
}

function scoreDocument(document: MarkdownDocument, terms: string[]): number {
  const title = normalize(document.title);
  const relativePath = normalize(document.relativePath);
  const headings = normalize(document.headings.map((heading) => heading.text).join(" "));
  const content = normalize(document.content);
  return terms.reduce((score, term) => {
    let next = score;
    if (title === term) next += 40; else if (title.includes(term)) next += 24;
    if (path.posix.basename(relativePath, ".md").includes(term)) next += 18;
    if (relativePath.includes(term)) next += 12;
    if (headings.includes(term)) next += 10;
    const matches = content.split(term).length - 1;
    next += Math.min(matches, 8) * 3;
    return next;
  }, 0);
}

export async function answerLibraryQuestion(rawRequest: unknown, environment: LibraryEnvironment = process.env): Promise<LibraryAssistantAnswer> {
  const request: LibraryQuestion = libraryQuestionSchema.parse(rawRequest);
  const config = parseLibraryConfig(environment);
  if (!config.ok) throw new Error("La bibliothèque n’est pas configurée.");
  const terms = significantTerms(request.question);
  if (!terms.length) return { question: request.question, provider: request.provider, fixture: request.provider === "mock", answer: "Aucun terme significatif n’a pu être extrait. Reformulez la question avec un sujet précis.", citations: [], documentsUsed: [], uncertainty: "Aucune source candidate." };
  const paths = flatten(await buildLibraryTree(config.rootPath));
  const documents: Array<{ document: MarkdownDocument; score: number }> = [];
  for (const relativePath of paths) {
    const document = await readMarkdownDocument(relativePath, environment);
    if (request.domain && !normalize(document.section).includes(normalize(request.domain)) && !normalize(document.relativePath).includes(normalize(request.domain))) continue;
    const score = scoreDocument(document, terms);
    if (score > 0) documents.push({ document, score });
  }
  const selected = documents.sort((left, right) => right.score - left.score || left.document.relativePath.localeCompare(right.document.relativePath, "fr")).slice(0, request.limit);
  const citations = selected.map(({ document, score }, index): LibraryCitation => {
    const passage = bestPassage(document, terms);
    const videoSource = document.relativePath === "02_SOURCES/videos.md" ? passage.excerpt : undefined;
    return { citationId: `S${index + 1}`, title: document.title, relativePath: document.relativePath, section: document.section, score, videoSource, ...passage };
  });
  if (!citations.length) return { question: request.question, provider: request.provider, fixture: request.provider === "mock", answer: "Aucun document de la bibliothèque ne soutient une réponse à cette question.", citations: [], documentsUsed: [], uncertainty: "Aucun résultat lexical; aucune réponse n’a été inventée." };
  const answer = request.provider === "mock"
    ? `Fixture locale : ${citations.length} document(s) correspondent lexicalement à la question. Consultez [${citations.map((item) => item.citationId).join("], [")}] pour vérifier les passages.`
    : `La bibliothèque contient ${citations.length} source(s) candidate(s). Les passages ci-dessous sont présentés sans synthèse générative; chaque élément renvoie au document original.`;
  return { question: request.question, provider: request.provider, fixture: request.provider === "mock", answer, citations, documentsUsed: citations.map((item) => item.relativePath) };
}
