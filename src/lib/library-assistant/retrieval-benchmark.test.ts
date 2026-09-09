import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { answerLibraryQuestion } from "./assistant";
import { RETRIEVAL_BENCHMARK_CASES, SYNTHETIC_BENCHMARK_DOCUMENTS } from "./retrieval-benchmark";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-retrieval-benchmark-"));
  roots.push(root);
  await writeFile(path.join(root, "INDEX.md"), "# Index\n\nNavigation générale seulement.\n", "utf8");
  for (const document of SYNTHETIC_BENCHMARK_DOCUMENTS) {
    const target = path.join(root, ...document.relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, document.content, "utf8");
  }
  return root;
}

async function fingerprint(root: string) {
  const hash = createHash("sha256");
  for (const document of SYNTHETIC_BENCHMARK_DOCUMENTS) {
    hash.update(document.relativePath); hash.update(await readFile(path.join(root, ...document.relativePath.split("/"))));
  }
  return hash.digest("hex");
}

describe("benchmark de récupération", () => {
  it("contient au moins vingt questions, toutes ancrées sur une note relative", () => {
    expect(RETRIEVAL_BENCHMARK_CASES).toHaveLength(21);
    expect(new Set(RETRIEVAL_BENCHMARK_CASES.map((item) => item.category))).toEqual(new Set(["notion-précise", "synonyme", "multi-source", "cross-domain", "comparaison", "notion-multi-vidéos"]));
    expect(RETRIEVAL_BENCHMARK_CASES.every((item) => item.expectedPath.endsWith(".md") && !item.expectedPath.startsWith("/") && !item.expectedPath.includes(".."))).toBe(true);
  });

  it("utilise seulement des documents, chemins et contenus synthétiques", () => {
    expect(SYNTHETIC_BENCHMARK_DOCUMENTS).toHaveLength(7);
    expect(SYNTHETIC_BENCHMARK_DOCUMENTS.every((document) => document.relativePath.startsWith("01_BIBLIOTHEQUE/") && document.relativePath.split("/").length === 4)).toBe(true);
  });

  it("s'exécute sur une fixture temporaire sans modifier sa bibliothèque", async () => {
    const root = await fixture(); const before = await fingerprint(root);
    for (const item of RETRIEVAL_BENCHMARK_CASES) {
      const answer = await answerLibraryQuestion({ question: item.question, provider: "extractive", limit: 12 }, { YOUTUBE_LIBRARY_PATH: root });
      const citation = answer.citations.find((candidate) => candidate.relativePath === item.expectedPath);
      expect(answer.citations[0]?.relativePath).toBe(item.expectedPath);
      expect(citation).toMatchObject({ anchor: item.expectedAnchor });
      expect(citation?.lineStart).toBeGreaterThanOrEqual(1);
      if (item.rejectIndexAsTop) expect(answer.citations[0]?.relativePath).not.toMatch(/(^|\/)INDEX\.md$/);
      if (item.requireMultipleSources) expect(answer.documentsUsed.length).toBeGreaterThanOrEqual(2);
    }
    expect(await fingerprint(root)).toBe(before);
  });
});
