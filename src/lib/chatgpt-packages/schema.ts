import { z } from "zod";

import { PACKAGE_EVENTS, PACKAGE_STATUSES } from "./constants";

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, "SHA-256 invalide.");
export const safeRelativeMarkdownPathSchema = z.string().min(1).max(500).refine((value) => {
  if (value.includes("\\") || value.includes("\0") || value.startsWith("/") || /^[a-z]:/i.test(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part && part !== "." && part !== "..") && value.toLowerCase().endsWith(".md");
}, "Chemin Markdown relatif invalide.");

export const chatGptPackageManifestSchema = z.object({
  schemaVersion: z.literal(1),
  packageId: z.string().uuid(),
  generatedAt: z.string().datetime({ offset: true }),
  acquisitionId: z.string().uuid(),
  source: z.object({
    type: z.literal("youtube-video"),
    videoId: z.string().regex(/^[A-Za-z0-9_-]{6,20}$/),
    title: z.string().trim().min(1).max(500),
    url: z.string().url().refine((value) => new URL(value).protocol === "https:", "URL HTTPS requise."),
    language: z.string().trim().min(2).max(40),
    sourceKind: z.enum(["manual-subtitles", "automatic-subtitles", "local-whisper", "uploaded-transcript"]),
  }).strict(),
  analysis: z.object({
    language: z.literal("fr"),
    technicalTerms: z.literal("english-inline"),
    detailLevel: z.literal("detailed"),
    focusOnSourceClaims: z.literal(true),
    allowExternalContext: z.literal(true),
    externalContextMustBeSeparated: z.literal(true),
    generateProjectIdeas: z.literal(false),
    aiTopicsReceiveExtraDepth: z.literal(true),
  }).strict(),
  transcript: z.object({
    wordCount: z.number().int().nonnegative(),
    characterCount: z.number().int().nonnegative(),
    sha256: sha256Schema,
    segmented: z.boolean(),
    partCount: z.number().int().min(1).max(12),
    overlapCharacters: z.number().int().nonnegative(),
  }).strict(),
  context: z.object({
    requiredFiles: z.array(safeRelativeMarkdownPathSchema),
    selectedFiles: z.array(safeRelativeMarkdownPathSchema),
    suggestedFilesRejected: z.array(safeRelativeMarkdownPathSchema),
  }).strict(),
  writeScope: z.object({
    createPrefixes: z.array(z.literal("01_BIBLIOTHEQUE/" )).length(1),
    replaceFiles: z.array(safeRelativeMarkdownPathSchema),
    systemFilesAllowed: z.array(z.enum(["INDEX.md", "00_SYSTEME/TAXONOMY.md"])),
  }).strict(),
  output: z.object({
    requiredFormat: z.literal("tubeknowledge-import-v1"),
    requiresZip: z.literal(true),
    requiresReview: z.literal(true),
  }).strict(),
}).strict();

export const packageRequestSchema = z.object({
  action: z.enum(["preview", "generate"]),
  acquisitionId: z.string().uuid(),
  selectedFiles: z.array(safeRelativeMarkdownPathSchema).max(100).default([]),
  suggestedFilesRejected: z.array(safeRelativeMarkdownPathSchema).max(100).default([]),
  allowStructuralUpdate: z.boolean().default(false),
  expectedSnapshot: z.record(safeRelativeMarkdownPathSchema, sha256Schema).optional(),
}).strict();

export const suggestionRequestSchema = z.object({
  acquisitionId: z.string().uuid(),
  limit: z.number().int().min(1).max(30).default(12),
}).strict();

export const packageStatusSchema = z.enum(PACKAGE_STATUSES);
export const packageEventSchema = z.enum(PACKAGE_EVENTS);

export type ChatGptPackageManifest = z.infer<typeof chatGptPackageManifestSchema>;
export type PackageRequest = z.infer<typeof packageRequestSchema>;
export type PackageStatus = z.infer<typeof packageStatusSchema>;
export type PackageEventType = z.infer<typeof packageEventSchema>;
