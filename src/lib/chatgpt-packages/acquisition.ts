import { readFile } from "node:fs/promises";

import { z } from "zod";

import { sha256 } from "@/lib/imports/hash";
import { getTranscriptionConfig, type TranscriptionConfig } from "@/lib/transcription/config";
import { loadJob, resolveArtifact } from "@/lib/transcription/runtime";
import type { AcquisitionJob } from "@/lib/transcription/types";

export interface PackageAcquisition {
  job: AcquisitionJob;
  transcript: string;
  metadata: Record<string, unknown>;
  segments: Array<{ start: number; end: number; text: string }>;
  segmentsDocument?: string;
}

const segmentsSchema = z.object({ schemaVersion: z.literal(1), segments: z.array(z.object({ start: z.number().nonnegative(), end: z.number().nonnegative(), text: z.string().min(1) }).passthrough()) }).passthrough();

function assertNoAbsolutePath(value: unknown): void {
  if (typeof value === "string" && (/^[a-z]:[\\/]/i.test(value) || value.startsWith("\\\\") || value.startsWith("//"))) throw new Error("Les métadonnées contiennent un chemin absolu interdit.");
  if (Array.isArray(value)) for (const item of value) assertNoAbsolutePath(item);
  else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) assertNoAbsolutePath(item);
}

export async function loadPackageAcquisition(acquisitionId: string, config: TranscriptionConfig = getTranscriptionConfig()): Promise<PackageAcquisition> {
  const job = await loadJob(config, acquisitionId);
  if (job.status !== "completed") throw new Error("Seule une acquisition terminée peut préparer un Paquet ChatGPT.");
  if (!job.artifacts.some((artifact) => artifact.name === "transcript.txt")) throw new Error("La transcription est absente de cette acquisition.");
  if (!job.artifacts.some((artifact) => artifact.name === "metadata.json")) throw new Error("Les métadonnées sont absentes de cette acquisition.");
  const [transcriptArtifact, metadataArtifact] = await Promise.all([
    resolveArtifact(config, acquisitionId, "transcript.txt"),
    resolveArtifact(config, acquisitionId, "metadata.json"),
  ]);
  const [transcript, metadataText] = await Promise.all([readFile(transcriptArtifact.path, "utf8"), readFile(metadataArtifact.path, "utf8")]);
  let metadata: Record<string, unknown>;
  try { metadata = JSON.parse(metadataText) as Record<string, unknown>; }
  catch { throw new Error("metadata.json est invalide."); }
  assertNoAbsolutePath(metadata);
  if (!transcript.trim()) throw new Error("La transcription est vide.");
  if (metadata.jobId !== acquisitionId) throw new Error("Les métadonnées ne correspondent pas à l’acquisition.");
  const declaredHash = typeof metadata.hashes === "object" && metadata.hashes !== null ? (metadata.hashes as Record<string, unknown>)["transcript.txt"] : undefined;
  if (typeof declaredHash === "string" && declaredHash.toLowerCase() !== sha256(transcript)) throw new Error("Le hash de la transcription ne correspond pas aux métadonnées.");
  let segments: Array<{ start: number; end: number; text: string }> = [];
  let segmentsDocument: string | undefined;
  if (job.artifacts.some((artifact) => artifact.name === "segments.json")) {
    const artifact = await resolveArtifact(config, acquisitionId, "segments.json");
    segmentsDocument = await readFile(artifact.path, "utf8");
    const parsed = segmentsSchema.parse(JSON.parse(segmentsDocument));
    segments = parsed.segments.map(({ start, end, text }) => ({ start, end, text }));
  }
  return { job, transcript, metadata, segments, segmentsDocument };
}
