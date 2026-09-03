import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { TranscriptionConfig } from "./config";
import { isInsidePath } from "./paths";
import { jobStatusSchema, videoInspectionSchema } from "./schemas";
import type { AcquisitionJob } from "./types";

export const ARTIFACT_ALLOWLIST = new Map([
  ["transcript.txt", { relativePath: "output/transcript.txt", contentType: "text/plain; charset=utf-8" }],
  ["transcript.vtt", { relativePath: "output/transcript.vtt", contentType: "text/vtt; charset=utf-8" }],
  ["segments.json", { relativePath: "output/segments.json", contentType: "application/json; charset=utf-8" }],
  ["metadata.json", { relativePath: "output/metadata.json", contentType: "application/json; charset=utf-8" }],
  ["acquisition-report.md", { relativePath: "output/acquisition-report.md", contentType: "text/markdown; charset=utf-8" }],
]);

const jobSchema: z.ZodType<AcquisitionJob> = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  status: jobStatusSchema,
  stage: z.string().max(100),
  progress: z.number().min(0).max(1).nullable(),
  message: z.string().max(2_000),
  title: z.string().max(500).optional(),
  sourceKind: z.enum(["manual-subtitles", "automatic-subtitles", "local-whisper", "uploaded-transcript"]).optional(),
  source: z.object({ type: z.enum(["youtube", "upload"]), canonicalUrl: z.string().url().optional(), videoId: z.string().optional(), originalName: z.string().optional() }).strict().optional(),
  inspection: videoInspectionSchema.optional(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
  artifacts: z.array(z.object({ kind: z.string(), name: z.string() }).strict()),
  error: z.object({ code: z.string(), message: z.string() }).strict().optional(),
  options: z.object({
    language: z.string().optional(), subtitleOrigin: z.enum(["manual", "automatic"]).optional(), subtitleFormat: z.enum(["vtt", "srt"]).optional(),
    profile: z.enum(["fast", "balanced", "quality"]).optional(), model: z.string().optional(),
    device: z.enum(["cpu", "cuda"]).optional(), computeType: z.string().optional(), keepAudio: z.boolean().optional(),
    startTime: z.number().optional(), endTime: z.number().optional(),
  }).strict().optional(),
}).strict();

export function assertJobId(id: string): string {
  return z.string().uuid().parse(id);
}

export function jobDirectory(config: Pick<TranscriptionConfig, "acquisitionsPath">, id: string): string {
  const target = path.join(config.acquisitionsPath, assertJobId(id));
  if (!isInsidePath(config.acquisitionsPath, target)) throw new Error("Identifiant d’acquisition invalide.");
  return target;
}

export async function createJobDirectory(config: TranscriptionConfig, source: AcquisitionJob["source"]): Promise<AcquisitionJob> {
  const id = randomUUID();
  const directory = jobDirectory(config, id);
  await Promise.all([
    mkdir(path.join(directory, "raw"), { recursive: true }),
    mkdir(path.join(directory, "work"), { recursive: true }),
    mkdir(path.join(directory, "output"), { recursive: true }),
    mkdir(path.join(directory, "logs"), { recursive: true }),
  ]);
  const now = new Date().toISOString();
  const job: AcquisitionJob = {
    schemaVersion: 1, id, createdAt: now, updatedAt: now, status: "queued", stage: "queued", progress: null,
    message: "Traitement en attente.", source, warnings: [], artifacts: [],
  };
  await saveJob(config, job);
  return job;
}

export async function saveJob(config: TranscriptionConfig, job: AcquisitionJob): Promise<void> {
  const valid = jobSchema.parse({ ...job, updatedAt: new Date().toISOString() });
  const directory = jobDirectory(config, valid.id);
  await mkdir(directory, { recursive: true });
  await assertNotSymlink(directory);
  const target = path.join(directory, "job.json");
  const temporary = path.join(directory, `.job.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(valid, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, target);
  Object.assign(job, valid);
}

export async function loadJob(config: TranscriptionConfig, id: string): Promise<AcquisitionJob> {
  const directory = jobDirectory(config, id);
  await assertNotSymlink(directory);
  await assertNotSymlink(path.join(directory, "job.json"));
  const content = await readFile(path.join(directory, "job.json"), "utf8");
  return jobSchema.parse(JSON.parse(content));
}

export async function listJobs(config: TranscriptionConfig): Promise<AcquisitionJob[]> {
  let entries;
  try { entries = await readdir(config.acquisitionsPath, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const jobs: AcquisitionJob[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try { jobs.push(await loadJob(config, entry.name)); } catch { /* Ignore incomplete/corrupt folders in listings. */ }
  }
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteJob(config: TranscriptionConfig, id: string): Promise<void> {
  const directory = jobDirectory(config, id);
  await assertNotSymlink(directory);
  await rm(directory, { recursive: true, force: true });
}

export async function resolveArtifact(config: Pick<TranscriptionConfig, "acquisitionsPath">, id: string, name: string): Promise<{ path: string; contentType: string; size: number }> {
  const definition = ARTIFACT_ALLOWLIST.get(name);
  if (!definition) throw new Error("Artifact non autorisé.");
  const directory = jobDirectory(config, id);
  const target = path.resolve(directory, ...definition.relativePath.split("/"));
  if (!isInsidePath(directory, target)) throw new Error("Chemin d’artifact invalide.");
  await assertNotSymlink(directory);
  await assertNotSymlink(path.join(directory, "output"));
  await assertNotSymlink(target);
  const details = await stat(target);
  if (!details.isFile()) throw new Error("Artifact introuvable.");
  return { path: target, contentType: definition.contentType, size: details.size };
}

export async function appendEventLog(config: TranscriptionConfig, id: string, line: string): Promise<void> {
  const directory = jobDirectory(config, id);
  await assertNotSymlink(directory);
  await assertNotSymlink(path.join(directory, "logs"));
  const target = path.join(directory, "logs", "events.jsonl");
  await writeFile(target, `${line}\n`, { encoding: "utf8", flag: "a", mode: 0o600 });
}

export async function readLastWorkerFailureCode(config: TranscriptionConfig, id: string): Promise<string | undefined> {
  const target = path.join(jobDirectory(config, id), "logs", "events.jsonl");
  await assertNotSymlink(path.dirname(target));
  await assertNotSymlink(target);
  const details = await stat(target);
  const bytesToRead = Math.min(details.size, 64 * 1024);
  const handle = await open(target, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    await handle.read(buffer, 0, bytesToRead, details.size - bytesToRead);
    const lines = buffer.toString("utf8").split(/\r?\n/).reverse();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as { type?: unknown; code?: unknown };
        if (event.type === "failed" && typeof event.code === "string" && /^[A-Z0-9_]{1,80}$/.test(event.code)) return event.code;
      } catch { /* Une ligne partielle au début de la fenêtre est ignorée. */ }
    }
    return undefined;
  } finally { await handle.close(); }
}

async function assertNotSymlink(target: string): Promise<void> {
  const details = await lstat(target);
  if (details.isSymbolicLink()) throw new Error("Lien symbolique interdit dans le runtime d’acquisition.");
}
