import { z } from "zod";

import { IMPORT_LIMITS } from "@/lib/imports/constants";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, "SHA-256 invalide.");
const commonOperation = z.object({
  path: z.string().min(1),
  contentFile: z.string().min(1),
  newSha256: sha256Schema,
});

export const importOperationSchema = z.discriminatedUnion("type", [
  commonOperation.extend({ type: z.literal("create"), expectedState: z.literal("absent") }),
  commonOperation.extend({ type: z.literal("replace"), expectedSha256: sha256Schema }),
]);

export const importManifestSchema = z.object({
  schemaVersion: z.literal(1),
  packageId: z.string().uuid(),
  generatedAt: z.string().datetime({ offset: true }),
  source: z.object({
    type: z.enum(["youtube-video", "manual-notes", "other"]),
    title: z.string().trim().min(1).max(500),
    url: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "URL source non sécurisée."),
  }),
  summary: z.string().trim().min(1).max(5000),
  structuralChange: z.object({
    level: z.enum(["none", "minor", "major"]),
    confirmationRequired: z.boolean(),
    summary: z.string().trim().min(1).max(2000),
  }),
  operations: z.array(importOperationSchema).min(1).max(IMPORT_LIMITS.maxOperations),
}).strict();

export type ImportManifest = z.infer<typeof importManifestSchema>;
export type ImportOperation = z.infer<typeof importOperationSchema>;
