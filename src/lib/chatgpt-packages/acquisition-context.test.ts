import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadPackageAcquisition } from "./acquisition";
import { isAllowedContextPath, listEligibleContextFiles, loadContextSelection, snapshotContextFile, suggestContextFiles } from "./context";
import { makeChatGptVault, makeCompletedAcquisition } from "./test-utils";
import { jobDirectory, loadJob, saveJob } from "@/lib/transcription/runtime";

const temporary: string[] = [];
async function temp(prefix: string) { const value = await mkdtemp(path.join(os.tmpdir(), prefix)); temporary.push(value); return value; }
afterEach(async () => { await Promise.all(temporary.splice(0).map((item) => rm(item, { recursive: true, force: true }))); });

describe("acquisition autorisée Phase 5", () => {
  it("accepte completed avec transcript et metadata cohérents", async () => {
    const runtime = await temp("tk-p5-acq-"); const acquisition = await makeCompletedAcquisition(runtime);
    expect((await loadPackageAcquisition(acquisition.id, acquisition.config)).job.status).toBe("completed");
  });
  it.each(["queued", "failed"] as const)("refuse le statut %s", async (status) => {
    const runtime = await temp("tk-p5-acq-"); const acquisition = await makeCompletedAcquisition(runtime); const job = await loadJob(acquisition.config, acquisition.id); job.status = status; await saveJob(acquisition.config, job);
    await expect(loadPackageAcquisition(acquisition.id, acquisition.config)).rejects.toThrow(/terminée/);
  });
  it("refuse transcript ou metadata absent et acquisition hors runtime", async () => {
    const runtime = await temp("tk-p5-acq-"); const acquisition = await makeCompletedAcquisition(runtime); const job = await loadJob(acquisition.config, acquisition.id); job.artifacts = job.artifacts.filter((artifact) => artifact.name !== "transcript.txt"); await saveJob(acquisition.config, job);
    await expect(loadPackageAcquisition(acquisition.id, acquisition.config)).rejects.toThrow(/transcription est absente/);
    await expect(loadPackageAcquisition("123e4567-e89b-42d3-a456-426614174000", acquisition.config)).rejects.toThrow();
  });
  it("refuse une fuite de chemin absolu dans metadata.json", async () => {
    const runtime = await temp("tk-p5-acq-"); const acquisition = await makeCompletedAcquisition(runtime);
    await writeFile(path.join(jobDirectory(acquisition.config, acquisition.id), "output", "metadata.json"), JSON.stringify({ schemaVersion: 1, jobId: acquisition.id, title: "Test", language: "fr", sourceKind: "manual-subtitles", runtimePath: "C:\\Users\\secret\\runtime" }), "utf8");
    await expect(loadPackageAcquisition(acquisition.id, acquisition.config)).rejects.toThrow(/chemin absolu/);
  });
});

describe("contexte vault contrôlé", () => {
  it("charge les fichiers requis et accepte un contexte de bibliothèque", async () => {
    const vault = await temp("tk-p5-vault-"); await makeChatGptVault(vault);
    const selection = await loadContextSelection(["01_BIBLIOTHEQUE/Programmation/TypeScript.md"], { YOUTUBE_LIBRARY_PATH: vault });
    expect(selection.required.map((item) => item.relativePath)).toEqual(expect.arrayContaining(["INDEX.md", "00_SYSTEME/TAXONOMY.md", "02_SOURCES/videos.md", "01_BIBLIOTHEQUE/Intelligence-artificielle/INDEX.md"]));
    expect(selection.selected).toHaveLength(1);
  });
  it("bloque un fichier requis absent", async () => {
    const vault = await temp("tk-p5-vault-"); await makeChatGptVault(vault); await rm(path.join(vault, "00_SYSTEME", "LIBRARY_RULES.md"));
    await expect(loadContextSelection([], { YOUTUBE_LIBRARY_PATH: vault })).rejects.toThrow(/Fichier requis absent/);
  });
  it("exclut système normal, backups, runtime, Obsidian et à traiter", async () => {
    const vault = await temp("tk-p5-vault-"); await makeChatGptVault(vault); const files = await listEligibleContextFiles({ YOUTUBE_LIBRARY_PATH: vault });
    for (const excluded of ["00_SYSTEME/ARCHITECTURE.md", "03_A_TRAITER/brouillon.md", ".backups/secret.md", ".tubeknowledge/technique.md", ".obsidian/config.md"]) expect(files).not.toContain(excluded);
    expect(isAllowedContextPath("01_BIBLIOTHEQUE/Programmation/TypeScript.md")).toBe(true);
  });
  it("refuse un symlink même s’il pointe vers un Markdown", async () => {
    const vault = await temp("tk-p5-vault-"); await makeChatGptVault(vault); const outsideDirectory = path.join(await temp("tk-p5-outside-"), "external"); await mkdir(outsideDirectory); await writeFile(path.join(outsideDirectory, "outside.md"), "# Dehors\n", "utf8");
    const link = path.join(vault, "01_BIBLIOTHEQUE", "link"); await symlink(outsideDirectory, link, "junction");
    await expect(snapshotContextFile("01_BIBLIOTHEQUE/link/outside.md", { YOUTUBE_LIBRARY_PATH: vault })).rejects.toThrow(/sort de la bibliothèque/);
  });
  it("produit des suggestions lexicales pondérées avec raison et limite stable", async () => {
    const vault = await temp("tk-p5-vault-"); const runtime = await temp("tk-p5-acq-"); await makeChatGptVault(vault); const acquisition = await makeCompletedAcquisition(runtime, "Transformers transformers LLM attention TypeScript.");
    const suggestions = await suggestContextFiles(acquisition.id, 2, { environment: { YOUTUBE_LIBRARY_PATH: vault }, transcriptionConfig: acquisition.config });
    expect(suggestions.length).toBeLessThanOrEqual(2);
    expect(suggestions[0].relativePath).toContain("Transformers.md");
    expect(suggestions[0].reason).toMatch(/lexicale|titre/);
    expect(suggestions).toEqual([...suggestions].sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath, "fr")));
  });
});
