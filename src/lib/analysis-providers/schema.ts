import { z } from "zod";

const relativeMarkdownPath = z.string().min(1).max(500).refine((value) => {
  if (value.includes("\\") || value.includes("\0") || value.startsWith("/") || /^[a-z]:/i.test(value)) return false;
  return value.split("/").every((part) => part && part !== "." && part !== "..") && value.toLowerCase().endsWith(".md");
}, "Chemin Markdown relatif invalide.");

export const analysisInputSchema = z.object({
  workflowId: z.string().uuid(),
  libraryLanguage: z.string().trim().min(2).max(40).default("fr"),
  transcript: z.string().min(1).max(500_000),
  metadata: z.object({
    title: z.string().trim().min(1).max(500),
    sourceUrl: z.string().url().refine((value) => new URL(value).protocol === "https:"),
    videoId: z.string().regex(/^[A-Za-z0-9_-]{6,20}$/),
    language: z.string().min(2).max(40),
  }).strict(),
  context: z.array(z.object({ relativePath: relativeMarkdownPath, content: z.string().max(200_000), sha256: z.string().regex(/^[a-f0-9]{64}$/i) }).strict()).max(100),
  writeScope: z.object({ createPrefixes: z.array(z.literal("01_BIBLIOTHEQUE/")).length(1), replaceFiles: z.array(relativeMarkdownPath).max(100) }).strict(),
  freshnessHash: z.string().regex(/^[a-f0-9]{64}$/i),
  confirmedPaid: z.boolean().default(false),
}).strict();

export const analysisDraftSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(5_000),
  claims: z.array(z.object({ statement: z.string().min(1).max(2_000), source: z.enum(["video", "context", "inference"]), citation: z.string().max(500).optional() }).strict()).min(1).max(100),
  proposedFiles: z.array(z.object({ type: z.enum(["create", "replace"]), path: relativeMarkdownPath, content: z.string().min(1).max(1_000_000) }).strict()).min(1).max(50),
  warnings: z.array(z.string().max(1_000)).max(50),
}).strict();

export type AnalysisInput = z.infer<typeof analysisInputSchema>;
export type AnalysisDraft = z.infer<typeof analysisDraftSchema>;
