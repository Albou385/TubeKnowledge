import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "@/lib/imports/hash";
import type { TranscriptionConfig } from "@/lib/transcription/config";
import { createJobDirectory, jobDirectory, saveJob } from "@/lib/transcription/runtime";

export async function makeChatGptVault(root: string): Promise<void> {
  const files: Record<string, string> = {
    "INDEX.md": "# Index\n\nIntelligence artificielle et TypeScript.\n",
    "00_SYSTEME/PROJECT_INSTRUCTIONS.md": "# Instructions du projet\n",
    "00_SYSTEME/LIBRARY_RULES.md": "# Règles de bibliothèque\n",
    "00_SYSTEME/TAXONOMY.md": "# Taxonomie\n",
    "02_SOURCES/videos.md": "# Vidéos\n\n| Titre | URL |\n|---|---|\n",
    "01_BIBLIOTHEQUE/Intelligence-artificielle/INDEX.md": "# Intelligence artificielle\n",
    "01_BIBLIOTHEQUE/Intelligence-artificielle/Transformers.md": "# Transformers\n\nLes modèles de langage utilisent l’attention.\n",
    "01_BIBLIOTHEQUE/Programmation/TypeScript.md": "# TypeScript\n\nTypage strict et Zod.\n",
    "03_A_TRAITER/brouillon.md": "# Brouillon exclu\n",
    ".backups/secret.md": "# Backup exclu\n",
    ".tubeknowledge/technique.md": "# Technique exclue\n",
    ".obsidian/config.md": "# Obsidian exclu\n",
    "00_SYSTEME/ARCHITECTURE.md": "# Système exclu\n",
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, ...relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

export function testTranscriptionConfig(runtimePath: string): TranscriptionConfig {
  return { runtimePath, acquisitionsPath: path.join(runtimePath, "acquisitions"), modelCachePath: path.join(runtimePath, "models"), pythonPath: "python", ffmpegPath: "ffmpeg", ffprobePath: "ffprobe", concurrency: 1, defaultModel: "small", defaultDevice: "cpu", defaultComputeType: "int8", maxVideoMinutes: 360 };
}

export async function makeCompletedAcquisition(runtimePath: string, transcript = "Les transformers et les LLM utilisent un mécanisme attention.\n"): Promise<{ id: string; config: TranscriptionConfig }> {
  const config = testTranscriptionConfig(runtimePath);
  const job = await createJobDirectory(config, { type: "youtube", canonicalUrl: "https://www.youtube.com/watch?v=abcdefghijk", videoId: "abcdefghijk" });
  job.status = "completed";
  job.stage = "completed";
  job.progress = 1;
  job.message = "Acquisition terminée.";
  job.title = "Comprendre les Transformers et LLM";
  job.sourceKind = "manual-subtitles";
  job.options = { language: "fr" };
  job.artifacts = [{ kind: "transcript", name: "transcript.txt" }, { kind: "metadata", name: "metadata.json" }, { kind: "segments", name: "segments.json" }];
  const output = path.join(jobDirectory(config, job.id), "output");
  await writeFile(path.join(output, "transcript.txt"), transcript, "utf8");
  await writeFile(path.join(output, "metadata.json"), `${JSON.stringify({ schemaVersion: 1, jobId: job.id, title: job.title, language: "fr", sourceKind: job.sourceKind, videoId: "abcdefghijk", canonicalUrl: "https://www.youtube.com/watch?v=abcdefghijk", hashes: { "transcript.txt": sha256(transcript) } }, null, 2)}\n`, "utf8");
  await writeFile(path.join(output, "segments.json"), `${JSON.stringify({ schemaVersion: 1, language: "fr", sourceKind: job.sourceKind, segments: [{ id: 0, start: 0, end: 4, text: transcript.trim() }] })}\n`, "utf8");
  await saveJob(config, job);
  return { id: job.id, config };
}
