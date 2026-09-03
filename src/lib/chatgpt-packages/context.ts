import { stat } from "node:fs/promises";
import path from "node:path";

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { sha256 } from "@/lib/imports/hash";
import { buildLibraryTree, readMarkdownDocument } from "@/lib/library/library-reader";
import { normalizeRelativeMarkdownPath } from "@/lib/library/path-security";
import type { LibraryNode } from "@/lib/library/types";
import { searchLibrary } from "@/lib/search/search";
import type { TranscriptionConfig } from "@/lib/transcription/config";

import { loadPackageAcquisition } from "./acquisition";
import { OPTIONAL_AI_INDEX, REQUIRED_VAULT_FILES } from "./constants";
import { extractSignificantTerms } from "./terms";

const EXCLUDED_PREFIXES = ["03_A_TRAITER/", ".backups/", ".tubeknowledge/", ".obsidian/"];
const REQUIRED_SET = new Set<string>(REQUIRED_VAULT_FILES);

export interface ContextSnapshot { relativePath: string; content: string; sha256: string; size: number; modifiedAt: string }
export interface ContextSuggestion { relativePath: string; title: string; score: number; reason: string }

function flatten(nodes: LibraryNode[]): string[] {
  return nodes.flatMap((node) => node.type === "file" ? [node.relativePath] : flatten(node.children));
}

export function isAllowedContextPath(value: string): boolean {
  let relativePath: string;
  try { relativePath = normalizeRelativeMarkdownPath(value); } catch { return false; }
  if (REQUIRED_SET.has(relativePath) || relativePath === OPTIONAL_AI_INDEX) return true;
  if (relativePath.startsWith("00_SYSTEME/")) return false;
  return !EXCLUDED_PREFIXES.some((prefix) => relativePath === prefix.slice(0, -1) || relativePath.startsWith(prefix));
}

export async function listEligibleContextFiles(environment: LibraryEnvironment = process.env): Promise<string[]> {
  const config = parseLibraryConfig(environment);
  if (!config.ok) throw new Error(config.message);
  return flatten(await buildLibraryTree(config.rootPath)).filter(isAllowedContextPath).sort((a, b) => a.localeCompare(b, "fr"));
}

export async function snapshotContextFile(relativePath: string, environment: LibraryEnvironment = process.env): Promise<ContextSnapshot> {
  const normalized = normalizeRelativeMarkdownPath(relativePath);
  if (!isAllowedContextPath(normalized)) throw new Error(`Contexte interdit : ${normalized}`);
  const config = parseLibraryConfig(environment);
  if (!config.ok) throw new Error(config.message);
  const document = await readMarkdownDocument(normalized, environment);
  const details = await stat(path.join(config.rootPath, ...normalized.split("/")));
  return { relativePath: normalized, content: document.content, sha256: sha256(document.content), size: Buffer.byteLength(document.content), modifiedAt: details.mtime.toISOString() };
}

export async function loadContextSelection(selectedFiles: string[], environment: LibraryEnvironment = process.env): Promise<{ required: ContextSnapshot[]; selected: ContextSnapshot[] }> {
  const requiredPaths: string[] = [...REQUIRED_VAULT_FILES];
  try { await snapshotContextFile(OPTIONAL_AI_INDEX, environment); requiredPaths.push(OPTIONAL_AI_INDEX); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const required: ContextSnapshot[] = [];
  for (const relativePath of requiredPaths) {
    try { required.push(await snapshotContextFile(relativePath, environment)); }
    catch (error) { if (REQUIRED_SET.has(relativePath)) throw new Error(`Fichier requis absent ou illisible : ${relativePath}`); throw error; }
  }
  const seen = new Set(required.map((item) => item.relativePath.toLocaleLowerCase("en-US")));
  const selected: ContextSnapshot[] = [];
  for (const candidate of selectedFiles) {
    const normalized = normalizeRelativeMarkdownPath(candidate);
    const key = normalized.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(await snapshotContextFile(normalized, environment));
  }
  return { required, selected };
}

export async function suggestContextFiles(acquisitionId: string, limit: number, options: { environment?: LibraryEnvironment; transcriptionConfig?: TranscriptionConfig } = {}): Promise<ContextSuggestion[]> {
  const environment = options.environment ?? process.env;
  const acquisition = await loadPackageAcquisition(acquisitionId, options.transcriptionConfig);
  const terms = extractSignificantTerms(`${acquisition.job.title ?? ""}\n${acquisition.transcript}`, 16);
  const aggregate = new Map<string, ContextSuggestion>();
  for (const { term, count } of terms) {
    const results = await searchLibrary({ q: term, limit: 20 }, environment);
    for (const result of results) {
      if (!isAllowedContextPath(result.relativePath) || REQUIRED_SET.has(result.relativePath) || result.relativePath === OPTIONAL_AI_INDEX) continue;
      const titleBoost = (acquisition.job.title ?? "").toLocaleLowerCase("fr").includes(term) ? 40 : 0;
      const score = result.score * Math.min(count, 8) + titleBoost;
      const existing = aggregate.get(result.relativePath);
      if (!existing || existing.score < score) aggregate.set(result.relativePath, { relativePath: result.relativePath, title: result.title, score, reason: titleBoost ? `Terme « ${term} » présent dans le titre et le document.` : `Correspondance lexicale avec « ${term} » (fréquence ${count}).` });
    }
  }
  return [...aggregate.values()].sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath, "fr")).slice(0, limit);
}
