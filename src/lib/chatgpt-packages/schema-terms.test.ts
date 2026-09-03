import { describe, expect, it } from "vitest";

import { chatGptPackageManifestSchema, packageRequestSchema } from "./schema";
import { extractSignificantTerms } from "./terms";

const manifest = {
  schemaVersion: 1, packageId: "123e4567-e89b-42d3-a456-426614174000", generatedAt: "2026-07-22T15:00:00.000Z", acquisitionId: "123e4567-e89b-42d3-a456-426614174001",
  source: { type: "youtube-video", videoId: "abcdefghijk", title: "Test", url: "https://www.youtube.com/watch?v=abcdefghijk", language: "fr", sourceKind: "manual-subtitles" },
  analysis: { language: "fr", technicalTerms: "english-inline", detailLevel: "detailed", focusOnSourceClaims: true, allowExternalContext: true, externalContextMustBeSeparated: true, generateProjectIdeas: false, aiTopicsReceiveExtraDepth: true },
  transcript: { wordCount: 10, characterCount: 50, sha256: "a".repeat(64), segmented: false, partCount: 1, overlapCharacters: 0 },
  context: { requiredFiles: ["INDEX.md"], selectedFiles: [], suggestedFilesRejected: [] },
  writeScope: { createPrefixes: ["01_BIBLIOTHEQUE/"], replaceFiles: ["02_SOURCES/videos.md"], systemFilesAllowed: [] },
  output: { requiredFormat: "tubeknowledge-import-v1", requiresZip: true, requiresReview: true },
};

describe("schémas Paquet ChatGPT V1", () => {
  it("accepte le manifeste versionné complet", () => expect(chatGptPackageManifestSchema.parse(manifest).schemaVersion).toBe(1));
  it.each([
    ["version inconnue", { ...manifest, schemaVersion: 2 }],
    ["packageId invalide", { ...manifest, packageId: "non" }],
    ["acquisitionId invalide", { ...manifest, acquisitionId: "non" }],
    ["source invalide", { ...manifest, source: { ...manifest.source, url: "http://example.test" } }],
    ["analyse invalide", { ...manifest, analysis: { ...manifest.analysis, generateProjectIdeas: true } }],
    ["write scope invalide", { ...manifest, writeScope: { ...manifest.writeScope, createPrefixes: ["03_A_TRAITER/"] } }],
    ["output contract invalide", { ...manifest, output: { ...manifest.output, requiredFormat: "autre" } }],
  ])("refuse %s", (_label, value) => expect(chatGptPackageManifestSchema.safeParse(value).success).toBe(false));
  it("refuse traversal, absolu et anti-slash dans la sélection", () => {
    for (const value of ["../INDEX.md", "C:\\vault\\INDEX.md", "dossier\\note.md"]) expect(packageRequestSchema.safeParse({ action: "preview", acquisitionId: manifest.acquisitionId, selectedFiles: [value] }).success).toBe(false);
  });
});

describe("extraction déterministe de mots significatifs", () => {
  it("gère français, anglais, acronymes, stopwords, fréquence, limite et stabilité", () => {
    const input = "Les LLM et the transformers utilisent attention. LLM attention TypeScript API avec and attention.";
    const first = extractSignificantTerms(input, 4);
    expect(first).toEqual(extractSignificantTerms(input, 4));
    expect(first).toHaveLength(4);
    expect(first[0]).toEqual({ term: "attention", count: 3 });
    expect(first.some((item) => item.term === "llm" && item.count === 2)).toBe(true);
    expect(first.some((item) => item.term === "the" || item.term === "avec")).toBe(false);
  });
});
