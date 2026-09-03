import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { answerLibraryQuestion, significantTerms } from "./assistant";
import { createLibraryContextPackage } from "./export";
import { deleteAssistantHistory, listAssistantHistory, recordAssistantHistory } from "./history";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-assistant-")); roots.push(root);
  await mkdir(path.join(root, "01_BIBLIOTHEQUE", "Intelligence-artificielle"), { recursive: true });
  await mkdir(path.join(root, "01_BIBLIOTHEQUE", "Alimentation"), { recursive: true });
  await mkdir(path.join(root, "02_SOURCES"), { recursive: true });
  await writeFile(path.join(root, "INDEX.md"), "# Index\n", "utf8");
  await writeFile(path.join(root, "01_BIBLIOTHEQUE", "Intelligence-artificielle", "agents.md"), "# Agents IA\n\n## Outils\n\nLes agents IA coordonnent des outils sous contrôle humain.\n", "utf8");
  await writeFile(path.join(root, "01_BIBLIOTHEQUE", "Alimentation", "conservation.md"), "# Conservation\n\nLes dates de conservation indiquent la durée recommandée.\n", "utf8");
  await writeFile(path.join(root, "02_SOURCES", "videos.md"), "# Vidéos\n\n- Prompting avancé — https://www.youtube.com/watch?v=dQw4w9WgXcQ\n", "utf8");
  return { root, environment: { YOUTUBE_LIBRARY_PATH: root } };
}

async function fingerprint(root: string) {
  const hash = createHash("sha256");
  async function walk(current: string) { for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) { const target = path.join(current, entry.name); if (entry.isDirectory()) await walk(target); else { hash.update(path.relative(root, target)); hash.update(await readFile(target)); } } }
  await walk(root); return hash.digest("hex");
}

describe("assistant de bibliothèque", () => {
  it("valide question vide et longue", async () => {
    const f = await fixture();
    await expect(answerLibraryQuestion({ question: "", provider: "extractive", limit: 6 }, f.environment)).rejects.toThrow();
    await expect(answerLibraryQuestion({ question: "x".repeat(501), provider: "extractive", limit: 6 }, f.environment)).rejects.toThrow();
  });

  it("conserve français, anglais et acronymes significatifs", () => {
    expect(significantTerms("Quelles vidéos parlent de prompting et des agents IA? ")).toEqual(expect.arrayContaining(["prompting", "agents", "ia"]));
    expect(significantTerms("What does my library say about RAG agents? ")).toEqual(expect.arrayContaining(["rag", "agents"]));
    expect(significantTerms("What does AI coordinate? ")).toContain("ai");
  });

  it("retourne plusieurs sources citées avec section, ligne et lien relatif", async () => {
    const f = await fixture();
    const answer = await answerLibraryQuestion({ question: "agents IA et prompting", provider: "extractive", limit: 6 }, f.environment);
    expect(answer.citations.length).toBeGreaterThanOrEqual(2);
    expect(answer.citations[0]).toMatchObject({ citationId: "S1", relativePath: expect.stringMatching(/\.md$/), lineStart: expect.any(Number) });
    const agents = answer.citations.find((citation) => citation.relativePath.endsWith("agents.md"))!;
    const source = await readFile(path.join(f.root, ...agents.relativePath.split("/")), "utf8");
    expect(agents.excerpt).toContain(source.split(/\r?\n/)[agents.lineStart - 1].trim());
    const anchored = await answerLibraryQuestion({ question: "outils contrôle humain", provider: "extractive", limit: 6 }, f.environment);
    expect(anchored.citations.find((citation) => citation.relativePath.endsWith("agents.md"))?.anchor).toBe("outils");
    expect(JSON.stringify(answer)).not.toContain(f.root);
  });

  it("signale honnêtement aucun résultat", async () => {
    const f = await fixture();
    const answer = await answerLibraryQuestion({ question: "xylophone quantique", provider: "extractive", limit: 6 }, f.environment);
    expect(answer.citations).toEqual([]); expect(answer.uncertainty).toContain("inventée");
  });

  it("filtre par domaine et marque le fournisseur mock", async () => {
    const f = await fixture();
    const answer = await answerLibraryQuestion({ question: "conservation", domain: "Alimentation", provider: "mock", limit: 6 }, f.environment);
    expect(answer).toMatchObject({ provider: "mock", fixture: true });
    expect(answer.citations.every((citation) => citation.relativePath.includes("Alimentation"))).toBe(true);
  });

  it("exporte un paquet manuel sans écrire dans le vault", async () => {
    const f = await fixture(); const before = await fingerprint(f.root);
    const zip = await createLibraryContextPackage({ question: "agents IA", provider: "extractive", limit: 6 }, f.environment);
    expect(zip.subarray(0, 2).toString()).toBe("PK");
    expect(await fingerprint(f.root)).toBe(before);
    expect(zip.toString("utf8")).not.toContain(f.root);
  });

  it("persiste et supprime seulement un historique local", async () => {
    const f = await fixture(); const historyRoot = await mkdtemp(path.join(os.tmpdir(), "tk-assistant-history-")); roots.push(historyRoot);
    const answer = await answerLibraryQuestion({ question: "agents IA", provider: "extractive", limit: 6 }, f.environment);
    const record = await recordAssistantHistory(answer, historyRoot, new Date("2026-07-27T05:00:00Z"));
    expect(await listAssistantHistory(historyRoot)).toHaveLength(1);
    await expect(deleteAssistantHistory(record.historyId, false, historyRoot)).rejects.toThrow("Confirmation");
    await deleteAssistantHistory(record.historyId, true, historyRoot);
    expect(await listAssistantHistory(historyRoot)).toEqual([]);
  });
});
