import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { answerLibraryQuestion, expandRetrievalTerms } from "./assistant";
import { RETRIEVAL_BENCHMARK_CASES } from "./retrieval-benchmark";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-retrieval-benchmark-"));
  roots.push(root);
  await writeFile(path.join(root, "INDEX.md"), "# Index\n\nNavigation générale seulement.\n", "utf8");
  const byPath = new Map<string, typeof RETRIEVAL_BENCHMARK_CASES>();
  for (const item of RETRIEVAL_BENCHMARK_CASES) {
    const cases = byPath.get(item.expectedPath);
    if (cases) cases.push(item);
    else byPath.set(item.expectedPath, [item]);
  }
  for (const [relativePath, cases] of byPath) {
    const target = path.join(root, ...relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    const sections = cases.map((item) => `## ${item.expectedAnchor ?? `source-${item.id}`}\n\n${item.question}\n`).join("\n");
    await writeFile(target, `# ${path.basename(relativePath, ".md")}\n\n${sections}`, "utf8");
  }
  // Les cas multi-source doivent également rester vérifiables dans une fixture
  // isolée; cette note ne représente aucune réponse utilisateur.
  await writeFile(path.join(root, "01_BIBLIOTHEQUE", "support.md"), "# Support\n\nOrganisation locale, recherche, sommeil et portabilité.\n", "utf8");
  return root;
}

async function fingerprint(root: string) {
  const hash = createHash("sha256");
  for (const item of RETRIEVAL_BENCHMARK_CASES) {
    const relativePath = item.expectedPath;
    hash.update(relativePath); hash.update(await readFile(path.join(root, ...relativePath.split("/"))));
  }
  return hash.digest("hex");
}

describe("benchmark de récupération", () => {
  it("contient au moins vingt questions, toutes ancrées sur une note relative", () => {
    expect(RETRIEVAL_BENCHMARK_CASES).toHaveLength(21);
    expect(new Set(RETRIEVAL_BENCHMARK_CASES.map((item) => item.category))).toEqual(new Set(["notion-précise", "synonyme", "multi-source", "cross-domain", "comparaison", "notion-multi-vidéos"]));
    expect(RETRIEVAL_BENCHMARK_CASES.every((item) => item.expectedPath.endsWith(".md") && !item.expectedPath.startsWith("/") && !item.expectedPath.includes(".."))).toBe(true);
  });

  it("étend seulement les synonymes locaux nécessaires au benchmark", () => {
    expect(expandRetrievalTerms(["ephemere", "prospection"])).toEqual(expect.arrayContaining(["throwaway", "jetable", "lead", "generation"]));
  });

  it("s'exécute sur une fixture temporaire sans modifier sa bibliothèque", async () => {
    const root = await fixture(); const before = await fingerprint(root);
    for (const item of RETRIEVAL_BENCHMARK_CASES) {
      const answer = await answerLibraryQuestion({ question: item.question, provider: "extractive", limit: 12 }, { YOUTUBE_LIBRARY_PATH: root });
      expect(answer.citations.some((citation) => citation.relativePath === item.expectedPath && citation.lineStart >= 1)).toBe(true);
      if (item.rejectIndexAsTop) expect(answer.citations[0]?.relativePath).not.toMatch(/(^|\/)INDEX\.md$/);
    }
    expect(await fingerprint(root)).toBe(before);
  });
});
