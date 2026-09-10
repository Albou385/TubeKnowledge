import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { TranscriptionConfig } from "./config";
import { AcquisitionManager } from "./manager";
import { createJobDirectory, loadJob, saveJob } from "./runtime";
import type { WorkerRunResult } from "./worker-process";
import type { AcquisitionJob } from "./types";

const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-manager-")); roots.push(root);
  const config: TranscriptionConfig = {
    runtimePath: root,
    acquisitionsPath: path.join(root, "acquisitions"),
    modelCachePath: path.join(root, "models"),
    pythonPath: "C:\\Runtime with spaces\\python.exe",
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe",
    concurrency: 1,
    defaultModel: "small",
    defaultDevice: "cpu",
    defaultComputeType: "int8",
    maxVideoMinutes: 360,
  };
  const job = await createJobDirectory(config, { type: "youtube", canonicalUrl: "https://www.youtube.com/watch?v=fixture01", videoId: "fixture01" });
  Object.assign(job, {
    title: "Fixture",
    status: "failed",
    stage: "failed",
    sourceKind: "automatic-subtitles",
    inspection: {
      videoId: "fixture01", title: "Fixture", durationSeconds: 10, canonicalUrl: "https://www.youtube.com/watch?v=fixture01",
      chapters: [], subtitles: [{ language: "fr", origin: "automatic", formats: [{ extension: "vtt" }] }], liveStatus: "not-live", warnings: [],
    },
    options: { language: "fr", subtitleOrigin: "automatic", subtitleFormat: "vtt" },
    error: { code: "SUBTITLE_DOWNLOAD_FAILED", message: "fixture" },
    artifacts: [{ kind: "report", name: "acquisition-report.md" }],
  } satisfies Partial<AcquisitionJob>);
  await saveJob(config, job);
  return { root, config, job };
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("reprise du manager d’acquisition", () => {
  it("annule une acquisition en attente de sélection pour la file vidéo", async () => {
    const { config, job } = await fixture();
    job.status = "waiting-for-selection"; job.stage = "waiting-for-selection"; delete job.error; await saveJob(config, job);
    const manager = new AcquisitionManager(config, { NODE_ENV: "test" });
    await expect(manager.cancel(job.id)).resolves.toMatchObject({ id: job.id, status: "canceled" });
  });

  it("réutilise le job, propage l’environnement et bloque un double démarrage", async () => {
    const { config, job } = await fixture();
    let calls = 0;
    let finish!: (value: WorkerRunResult) => void;
    const workerRunner = ((command: string, args: string[], options: Parameters<typeof import("./worker-process").runWorkerProcess>[2]) => {
      calls += 1;
      expect(command).toBe(config.pythonPath);
      expect(args).toContain("download-subtitles");
      expect(args).toContain("fr");
      expect(options.cwd).toContain("transcription-worker");
      expect(options.environment).toMatchObject({ FIXTURE_LAUNCHER_VALUE: "propagated", PYTHONUTF8: "1", PYTHONUNBUFFERED: "1" });
      return { promise: new Promise<WorkerRunResult>((resolve) => { finish = resolve; }), cancel: async () => undefined };
    }) as typeof import("./worker-process").runWorkerProcess;
    const manager = new AcquisitionManager(
      config,
      { NODE_ENV: "test", FIXTURE_LAUNCHER_VALUE: "propagated" },
      workerRunner,
    );

    const first = await manager.resume(job.id);
    const second = await manager.resume(job.id);
    expect(first.id).toBe(job.id);
    expect(second.id).toBe(job.id);
    expect(calls).toBe(1);
    expect(second.artifacts).toEqual(job.artifacts);
    finish({ result: { ok: true }, stderr: "" });
    await vi.waitFor(async () => {
      expect((await loadJob(config, job.id)).status).toBe("completed");
    });
  });

  it("marque un worker actif comme interrompu après redémarrage puis reprend le même job", async () => {
    const { config, job } = await fixture();
    job.status = "queued"; job.stage = "queued"; delete job.error; await saveJob(config, job);
    const manager = new AcquisitionManager(
      config,
      { NODE_ENV: "test" },
      (() => ({ promise: Promise.resolve({ result: {}, stderr: "" }), cancel: async () => undefined })) as typeof import("./worker-process").runWorkerProcess,
    );
    await expect(manager.get(job.id)).resolves.toMatchObject({ id: job.id, status: "interrupted", error: { code: "TRANSCRIPTION_INTERRUPTED" } });
    const interrupted = await loadJob(config, job.id);
    expect(interrupted).toMatchObject({ status: "interrupted", error: { code: "TRANSCRIPTION_INTERRUPTED" } });
    await expect(manager.resume(job.id)).resolves.toMatchObject({ id: job.id });
    await vi.waitFor(async () => {
      expect((await loadJob(config, job.id)).status).toBe("completed");
    });
  });

  it("échoue proprement avec un runtime non inscriptible sans toucher un vault fixture", async () => {
    const { root, config } = await fixture();
    const vault = path.join(root, "vault.md"); await writeFile(vault, "inchangé", "utf8");
    const blocked = path.join(root, "blocked"); await writeFile(blocked, "fichier", "utf8");
    const invalid = { ...config, acquisitionsPath: path.join(blocked, "acquisitions") };
    await expect(createJobDirectory(invalid, { type: "upload" })).rejects.toThrow();
    expect(await readFile(vault, "utf8")).toBe("inchangé");
  });
});
