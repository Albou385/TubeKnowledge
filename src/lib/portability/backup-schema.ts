import { z } from "zod";

export const backupFileSchema = z.object({ path: z.string().min(1), size: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const backupProvenanceSchema = z.object({
  trigger: z.enum(["bootstrap", "before-write", "restore", "manual", "manual-check", "unknown"]),
  relatedId: z.string().uuid().optional(),
}).strict();
export const backupManifestSchema = z.object({
  schemaVersion: z.literal(1), backupId: z.string().uuid(), createdAt: z.iso.datetime(), createdByMachineId: z.string().uuid(),
  profile: z.enum(["knowledge", "full", "before-write"]), sourceSnapshotId: z.string().uuid(), sourceRootHash: z.string().regex(/^[a-f0-9]{64}$/),
  fileCount: z.number().int().nonnegative(), totalBytes: z.number().int().nonnegative(), appVersion: z.string().min(1).max(50), gitCommit: z.string().regex(/^(?:unknown|[a-f0-9]{7,40})$/), provenance: backupProvenanceSchema.optional(), files: z.array(backupFileSchema),
}).strict();

