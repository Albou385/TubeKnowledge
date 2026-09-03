export const CHATGPT_PACKAGE_ROOT = "tubeknowledge-chatgpt-package";

export const CHATGPT_PACKAGE_LIMITS = {
  simpleTranscriptCharacters: 80_000,
  targetSegmentCharacters: 60_000,
  overlapCharacters: 2_000,
  maxSegments: 12,
  maxZipBytes: 25 * 1024 * 1024,
  maxUncompressedBytes: 50 * 1024 * 1024,
  maxEntries: 150,
  maxContextFiles: 100,
  maxUploadBytes: 10 * 1024 * 1024,
} as const;

export const REQUIRED_VAULT_FILES = [
  "00_SYSTEME/PROJECT_INSTRUCTIONS.md",
  "00_SYSTEME/LIBRARY_RULES.md",
  "00_SYSTEME/TAXONOMY.md",
  "INDEX.md",
  "02_SOURCES/videos.md",
] as const;

export const OPTIONAL_AI_INDEX = "01_BIBLIOTHEQUE/Intelligence-artificielle/INDEX.md";

export const SHORT_CHATGPT_INSTRUCTION = `Analyse ce paquet selon REQUEST.md et les contrats inclus.
Produis un fichier ZIP de résultat strictement compatible avec
PHASE3_IMPORT_PACKAGE_V1.md. Ne réponds pas seulement avec du texte :
le livrable final doit être le ZIP téléchargeable.`;

export const PACKAGE_STATUSES = [
  "draft",
  "ready",
  "downloaded",
  "result-received",
  "result-previewed",
  "imported",
  "rejected",
  "deleted",
] as const;

export const PACKAGE_EVENTS = [
  "package-created",
  "package-downloaded",
  "result-uploaded",
  "result-rejected",
  "result-previewed",
  "import-success",
  "import-failed",
  "package-deleted",
] as const;
