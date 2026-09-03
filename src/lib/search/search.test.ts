import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { searchLibrary } from "@/lib/search/search";
import { MAX_SEARCH_QUERY_LENGTH, parseSearchRequest } from "@/lib/search/search-schema";

describe("recherche locale", () => {
  let rootPath: string;
  let environment: { YOUTUBE_LIBRARY_PATH: string };

  beforeEach(async () => {
    rootPath = await mkdtemp(path.join(os.tmpdir(), "tubeknowledge-search-"));
    environment = { YOUTUBE_LIBRARY_PATH: rootPath };
    await mkdir(path.join(rootPath, "01_BIBLIOTHEQUE", "Web"), { recursive: true });
    await writeFile(path.join(rootPath, "INDEX.md"), "# Accueil\n\nBienvenue.", "utf8");
    await writeFile(path.join(rootPath, "01_BIBLIOTHEQUE", "Web", "typescript-guide.md"), "# Guide pratique\n\nLe typage statique facilite la maintenance du contenu.", "utf8");
    await writeFile(path.join(rootPath, "01_BIBLIOTHEQUE", "Web", "autre.md"), "# TypeScript avancé\n\nGénériques et interfaces.", "utf8");
    await writeFile(path.join(rootPath, "01_BIBLIOTHEQUE", "Web", "contenu.md"), "# Sujet\n\nUne longue introduction explique la recherche locale dans les fichiers Markdown et ses résultats.", "utf8");
  });

  afterEach(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  it("recherche par nom de fichier", async () => {
    const results = await searchLibrary({ q: "typescript-guide" }, environment);
    expect(results[0]?.relativePath).toBe("01_BIBLIOTHEQUE/Web/typescript-guide.md");
  });

  it("recherche par titre principal", async () => {
    const results = await searchLibrary({ q: "TypeScript avancé" }, environment);
    expect(results[0]?.title).toBe("TypeScript avancé");
  });

  it("recherche dans le contenu et génère un extrait autour de la correspondance", async () => {
    const results = await searchLibrary({ q: "recherche locale" }, environment);
    expect(results[0]?.excerpt).toContain("recherche locale");
    expect(results[0]?.section).toBe("01_BIBLIOTHEQUE");
  });

  it("rejette une requête vide", () => {
    expect(() => parseSearchRequest({ q: "   " })).toThrow("Saisissez");
  });

  it("rejette une requête trop longue", () => {
    expect(() => parseSearchRequest({ q: "x".repeat(MAX_SEARCH_QUERY_LENGTH + 1) })).toThrow("limitée");
  });

  it("respecte la limite de résultats", async () => {
    const results = await searchLibrary({ q: "i", limit: 2 }, environment);
    expect(results).toHaveLength(2);
  });

  it("ne renvoie jamais le chemin absolu de la bibliothèque", async () => {
    const results = await searchLibrary({ q: "maintenance" }, environment);
    expect(JSON.stringify(results)).not.toContain(rootPath);
  });
});
