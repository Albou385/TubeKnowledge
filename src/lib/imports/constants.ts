export const IMPORT_LIMITS = {
  maxZipBytes: 10 * 1024 * 1024,
  maxEntries: 100,
  maxMarkdownBytes: 1024 * 1024,
  maxUncompressedBytes: 10 * 1024 * 1024,
  maxOperations: 50,
  maxDiffLines: 500,
  sessionTtlMs: 30 * 60 * 1000,
  lockStaleMs: 30 * 60 * 1000,
} as const;

export const IMPORT_ROOT = "tubeknowledge-import";
