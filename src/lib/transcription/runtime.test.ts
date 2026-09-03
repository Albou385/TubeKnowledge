import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { TranscriptionConfig } from "./config";
import { appendEventLog, createJobDirectory, listJobs, loadJob, readLastWorkerFailureCode, resolveArtifact, saveJob } from "./runtime";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-runtime-")); roots.push(root);
  const config: TranscriptionConfig = { runtimePath: root, acquisitionsPath: path.join(root, "acquisitions"), modelCachePath: path.join(root, "models"), pythonPath: "python", ffmpegPath: "ffmpeg", ffprobePath: "ffprobe", concurrency: 1, defaultModel: "small", defaultDevice: "cpu", defaultComputeType: "int8", maxVideoMinutes: 360 };
  return { root, config };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("runtime d’acquisition", () => {
  it("crée la structure opaque et persiste atomiquement", async () => {
    const { config } = await fixture(); const job = await createJobDirectory(config, { type: "upload", originalName: "notes.txt" });
    job.title = "Test"; await saveJob(config, job);
    expect((await loadJob(config, job.id)).title).toBe("Test");
    expect((await listJobs(config)).map((item) => item.id)).toEqual([job.id]);
    expect(await readFile(path.join(config.acquisitionsPath, job.id, "job.json"), "utf8")).not.toContain(config.runtimePath);
  });

  it("sert uniquement les artifacts allowlistés", async () => {
    const { config } = await fixture(); const job = await createJobDirectory(config, { type: "upload" });
    const output = path.join(config.acquisitionsPath, job.id, "output"); await mkdir(output, { recursive: true }); await writeFile(path.join(output, "transcript.txt"), "ok");
    expect((await resolveArtifact(config, job.id, "transcript.txt")).size).toBe(2);
    await expect(resolveArtifact(config, job.id, "../job.json")).rejects.toThrow("non autorisé");
    await expect(resolveArtifact(config, job.id, "secret.env")).rejects.toThrow("non autorisé");
  });

  it("lit seulement le dernier code worker fermé du journal JSONL", async () => {
    const { config } = await fixture(); const job = await createJobDirectory(config, { type: "upload" });
    await appendEventLog(config, job.id, JSON.stringify({ type: "failed", code: "WORKER_FAILED", message: "fixture" }));
    await appendEventLog(config, job.id, JSON.stringify({ type: "failed", code: "YOUTUBE_RATE_LIMITED", message: "fixture" }));
    expect(await readLastWorkerFailureCode(config, job.id)).toBe("YOUTUBE_RATE_LIMITED");
  });

  it("refuse un artifact remplacé par un lien symbolique", async () => {
    const { root, config } = await fixture(); const job = await createJobDirectory(config, { type: "upload" });
    const outside = path.join(root, "outside.txt"); await writeFile(outside, "secret");
    const target = path.join(config.acquisitionsPath, job.id, "output", "transcript.txt");
    try { await symlink(outside, target, "file"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") return; throw error; }
    await expect(resolveArtifact(config, job.id, "transcript.txt")).rejects.toThrow("symbolique");
  });
});
