import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getTranscriptionConfig, WHISPER_PROFILES, type TranscriptionConfig } from "./config";
import { startAcquisitionSchema, videoInspectionSchema, type WorkerEvent } from "./schemas";
import {
  ARTIFACT_ALLOWLIST,
  appendEventLog,
  createJobDirectory,
  deleteJob,
  jobDirectory,
  listJobs,
  loadJob,
  saveJob,
} from "./runtime";
import { TERMINAL_STATUSES, type AcquisitionJob, type JobStatus } from "./types";
import { validateTranscriptUpload } from "./upload";
import { validateYoutubeUrl } from "./youtube-url";
import { runWorkerProcess, terminateProcessTree, type WorkerChildProcess } from "./worker-process";
import { normalizePublicError, workerFailure } from "./public-errors";
import type { PublicTranscriptionErrorCode } from "./error-catalog";

type QueueItem = { id: string; run: () => Promise<void> };
type WorkerRunner = typeof runWorkerProcess;
const ACTIVE_AFTER_RESTART = new Set<JobStatus>([
  "queued", "inspecting", "downloading-subtitles", "normalizing-subtitles", "downloading-audio", "probing-audio",
  "converting-audio", "loading-model", "transcribing", "normalizing-transcript", "canceling",
]);

function statusForStage(stage: string, fallback: JobStatus): JobStatus {
  const aliases: Record<string, JobStatus> = {
    inspect: "inspecting", inspecting: "inspecting", "downloading-subtitles": "downloading-subtitles",
    "normalizing-subtitles": "normalizing-subtitles", "downloading-audio": "downloading-audio",
    "probing-audio": "probing-audio", "converting-audio": "converting-audio", "loading-model": "loading-model",
    transcribing: "transcribing", "normalizing-transcript": "normalizing-transcript",
  };
  return aliases[stage] ?? fallback;
}

export class AcquisitionManager {
  private readonly queue: QueueItem[] = [];
  private readonly active = new Map<string, WorkerChildProcess>();
  private readonly running = new Set<string>();
  private readonly cancelRequested = new Set<string>();
  private initialized = false;

  constructor(
    readonly config: TranscriptionConfig = getTranscriptionConfig(),
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly workerRunner: WorkerRunner = runWorkerProcess,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    for (const job of await listJobs(this.config)) {
      if (ACTIVE_AFTER_RESTART.has(job.status)) {
        job.status = "interrupted";
        job.stage = "interrupted";
        job.progress = null;
        job.message = "Traitement interrompu par le redémarrage de l’application.";
        job.error = normalizePublicError(workerFailure("TRANSCRIPTION_INTERRUPTED"), "TRANSCRIPTION_INTERRUPTED").payload;
        await saveJob(this.config, job);
      }
    }
  }

  async inspect(rawUrl: string): Promise<AcquisitionJob> {
    await this.initialize();
    const url = validateYoutubeUrl(rawUrl);
    const job = await createJobDirectory(this.config, { type: "youtube", canonicalUrl: url.canonicalUrl, videoId: url.videoId });
    if (url.playlistIgnored) job.warnings.push({ code: "PLAYLIST_IGNORED", message: "La playlist a été ignorée; seule la vidéo sera traitée." });
    job.status = "inspecting";
    job.stage = "inspecting";
    job.message = "Inspection de la vidéo sans téléchargement.";
    await saveJob(this.config, job);
    try {
      const result = await this.runCommand(job, "inspect", ["--url", url.canonicalUrl, "--max-minutes", String(this.config.maxVideoMinutes)], 300_000);
      const inspection = videoInspectionSchema.parse(result.inspection);
      if (inspection.liveStatus === "is-live" || inspection.liveStatus === "upcoming") throw new Error("Les directs en cours ou à venir ne sont pas pris en charge.");
      if (inspection.durationSeconds > this.config.maxVideoMinutes * 60) throw new Error(`La vidéo dépasse la limite de ${this.config.maxVideoMinutes} minutes.`);
      inspection.warnings = [...job.warnings, ...inspection.warnings];
      job.inspection = inspection;
      job.title = inspection.title;
      job.status = "waiting-for-selection";
      job.stage = "waiting-for-selection";
      job.progress = null;
      job.message = "Inspection terminée. Choisissez une source de transcription.";
      await this.writeSource(job);
      await saveJob(this.config, job);
      return job;
    } catch (error) {
      await this.fail(job, "INSPECTION_FAILED", error);
      throw error;
    }
  }

  async start(input: unknown): Promise<AcquisitionJob> {
    await this.initialize();
    const request = startAcquisitionSchema.parse(input);
    const job = await loadJob(this.config, request.jobId);
    if (job.status !== "waiting-for-selection" || !job.inspection || !job.source?.canonicalUrl) throw new Error("Cette acquisition n’attend pas de sélection.");
    if (request.source.kind === "subtitles") {
      const source = request.source;
      const track = job.inspection.subtitles.find((item) => item.language === source.language && item.origin === source.origin && item.formats.some((format) => format.extension === source.format));
      if (!track) throw new Error("La piste de sous-titres sélectionnée n’est pas disponible.");
      job.sourceKind = source.origin === "manual" ? "manual-subtitles" : "automatic-subtitles";
      job.options = { language: source.language, subtitleOrigin: source.origin, subtitleFormat: source.format };
      job.status = "queued"; job.stage = "queued"; job.message = "Piste de sous-titres en attente de traitement.";
      await saveJob(this.config, job);
      this.enqueue(job.id, () => this.runSubtitlePipeline(job.id, source.language, source.origin, source.format));
    } else {
      const duration = job.inspection.durationSeconds;
      if (duration > 120 * 60 && !request.source.confirmLongVideo) throw new Error("Une confirmation renforcée est requise au-delà de 120 minutes.");
      if (request.source.profile === "quality" && !request.source.confirmQuality) throw new Error("Le profil Qualité exige une confirmation explicite.");
      if (!request.source.confirmModelDownload) throw new Error("Confirmez explicitement le téléchargement éventuel du modèle Whisper.");
      if (request.source.startTime !== undefined && request.source.endTime !== undefined && request.source.startTime >= request.source.endTime) throw new Error("La plage audio est invalide.");
      if (request.source.endTime !== undefined && request.source.endTime > duration) throw new Error("La fin de plage dépasse la durée de la vidéo.");
      const profile = WHISPER_PROFILES[request.source.profile];
      const device = request.source.profile === "quality" ? request.source.device : profile.device;
      const computeType = request.source.profile === "quality" ? request.source.computeType : profile.computeType;
      job.sourceKind = "local-whisper";
      job.options = {
        profile: request.source.profile, model: profile.model, language: request.source.language, device, computeType,
        keepAudio: request.source.keepAudio, startTime: request.source.startTime, endTime: request.source.endTime,
      };
      if (duration > 45 * 60) job.warnings.push({ code: "LONG_VIDEO", message: "Cette vidéo dépasse 45 minutes; le traitement CPU peut être long." });
      job.status = "queued"; job.stage = "queued"; job.message = "Transcription locale en attente de traitement.";
      await saveJob(this.config, job);
      this.enqueue(job.id, () => this.runWhisperPipeline(job.id));
    }
    return loadJob(this.config, job.id);
  }

  async upload(fileName: string, bytes: Buffer, title: string, sourceUrl?: string): Promise<AcquisitionJob> {
    await this.initialize();
    const upload = validateTranscriptUpload(fileName, bytes);
    const job = await createJobDirectory(this.config, { type: "upload", originalName: path.basename(fileName), canonicalUrl: sourceUrl || undefined });
    job.title = title;
    job.sourceKind = "uploaded-transcript";
    const inputName = `input${upload.extension}`;
    await writeFile(path.join(jobDirectory(this.config, job.id), "raw", inputName), upload.content, { encoding: "utf8", mode: 0o600 });
    await this.writeSource(job);
    await saveJob(this.config, job);
    this.enqueue(job.id, () => this.runUploadPipeline(job.id, inputName));
    return job;
  }

  async resume(id: string): Promise<AcquisitionJob> {
    await this.initialize();
    const job = await loadJob(this.config, id);
    if (this.running.has(id) || this.active.has(id) || this.queue.some((item) => item.id === id)) return this.readonlyView(job);
    if (!(["failed", "interrupted"] as JobStatus[]).includes(job.status)) throw new Error("Cette acquisition ne peut pas être reprise.");
    if (!job.source?.canonicalUrl) throw new Error("La source de cette acquisition est incomplète.");

    if (job.sourceKind === "manual-subtitles" || job.sourceKind === "automatic-subtitles") {
      const language = job.options?.language;
      const origin = job.options?.subtitleOrigin ?? (job.sourceKind === "manual-subtitles" ? "manual" : "automatic");
      const matchingTrack = job.inspection?.subtitles.find((track) => track.language === language && track.origin === origin);
      const format = job.options?.subtitleFormat ?? matchingTrack?.formats[0]?.extension;
      if (!language || !format || !matchingTrack?.formats.some((item) => item.extension === format)) throw new Error("La piste sélectionnée ne peut pas être reprise.");
      job.options = { ...job.options, language, subtitleOrigin: origin, subtitleFormat: format };
      job.status = "queued"; job.stage = "queued"; job.progress = null; job.message = "Reprise de la même piste de sous-titres en attente."; delete job.error;
      await saveJob(this.config, job);
      this.enqueue(job.id, () => this.runSubtitlePipeline(job.id, language, origin, format));
      return loadJob(this.config, job.id);
    }

    if (job.sourceKind === "local-whisper") {
      job.status = "queued"; job.stage = "queued"; job.progress = null; job.message = "Reprise de la transcription locale en attente."; delete job.error;
      await saveJob(this.config, job);
      this.enqueue(job.id, () => this.runWhisperPipeline(job.id));
      return loadJob(this.config, job.id);
    }

    throw new Error("Ce type d’acquisition ne peut pas être repris automatiquement.");
  }

  async cancel(id: string): Promise<AcquisitionJob> {
    await this.initialize();
    const job = await loadJob(this.config, id);
    if (TERMINAL_STATUSES.has(job.status)) throw new Error("Ce traitement ne peut pas être annulé.");
    job.status = "canceling";
    job.stage = "canceling";
    job.progress = null;
    job.message = "Annulation en cours.";
    await saveJob(this.config, job);
    this.cancelRequested.add(id);
    const queued = this.queue.findIndex((item) => item.id === id);
    if (queued >= 0) this.queue.splice(queued, 1);
    const process = this.active.get(id);
    if (process) await terminateProcessTree(process);
    await this.cleanupPartials(id);
    job.status = "canceled";
    job.stage = "canceled";
    job.message = "Traitement annulé; fichiers partiels nettoyés.";
    await saveJob(this.config, job);
    return job;
  }

  async remove(id: string): Promise<void> {
    await this.initialize();
    const job = await loadJob(this.config, id);
    if (!TERMINAL_STATUSES.has(job.status)) throw new Error("Terminez ou annulez l’acquisition avant de la supprimer.");
    await deleteJob(this.config, id);
  }

  async get(id: string): Promise<AcquisitionJob> {
    await this.initialize();
    return this.readonlyView(await loadJob(this.config, id));
  }
  async list(): Promise<AcquisitionJob[]> { return (await listJobs(this.config)).map((job) => this.readonlyView(job)); }

  private enqueue(id: string, run: () => Promise<void>): void {
    this.queue.push({ id, run });
    void this.pump();
  }

  private async pump(): Promise<void> {
    while (this.running.size < this.config.concurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) return;
      this.running.add(item.id);
      void item.run().finally(() => { this.active.delete(item.id); this.running.delete(item.id); void this.pump(); });
    }
  }

  private async runSubtitlePipeline(id: string, language: string, origin: "manual" | "automatic", format: "vtt" | "srt"): Promise<void> {
    const job = await loadJob(this.config, id);
    try {
      await this.runCommand(job, "download-subtitles", ["--url", job.source!.canonicalUrl!, "--language", language, "--origin", origin, "--format", format, "--title", job.title!], 1_800_000);
      await this.complete(job);
    } catch (error) { if ((await loadJob(this.config, id)).status !== "canceled") await this.fail(job, "SUBTITLES_FAILED", error); }
  }

  private async runWhisperPipeline(id: string): Promise<void> {
    const job = await loadJob(this.config, id);
    const options = job.options!;
    try {
      const rangeArgs = [
        ...(options.startTime !== undefined ? ["--start-time", String(options.startTime)] : []),
        ...(options.endTime !== undefined ? ["--end-time", String(options.endTime)] : []),
      ];
      await this.runCommand(job, "download-audio", ["--url", job.source!.canonicalUrl!, ...rangeArgs], 7_200_000);
      await this.runCommand(job, "transcribe", [
        "--title", job.title!, "--model", options.model!, "--device", options.device!, "--compute-type", options.computeType!,
        "--confirm-model-download", ...(options.language ? ["--language", options.language] : []),
        ...(options.keepAudio ? ["--keep-audio"] : []), ...rangeArgs,
      ], 86_400_000);
      await this.complete(job);
    } catch (error) {
      const current = await loadJob(this.config, id);
      if (current.status !== "canceled") {
        await this.fail(job, "TRANSCRIPTION_FAILED", error);
      }
    }
  }

  private async runUploadPipeline(id: string, inputName: string): Promise<void> {
    const job = await loadJob(this.config, id);
    try {
      await this.runCommand(job, "normalize-upload", ["--input", `raw/${inputName}`, "--title", job.title!, ...(job.source?.canonicalUrl ? ["--url", job.source.canonicalUrl] : [])], 300_000);
      await this.complete(job);
    } catch (error) { if ((await loadJob(this.config, id)).status !== "canceled") await this.fail(job, "UPLOAD_FAILED", error); }
  }

  private async runCommand(job: AcquisitionJob, command: string, args: string[], timeoutMs: number): Promise<Record<string, unknown>> {
    if (this.cancelRequested.has(job.id)) throw new Error("Traitement annulé avant le lancement du worker.");
    const directory = jobDirectory(this.config, job.id);
    const workerRoot = path.resolve(process.cwd(), "transcription-worker");
    const invocation = ["-m", "tubeknowledge_worker.cli", command, "--job-dir", directory, ...args];
    const runner = this.workerRunner(this.config.pythonPath, invocation, {
      cwd: workerRoot,
      timeoutMs,
      unavailableCode: "PYTHON_RUNTIME_UNAVAILABLE",
      environment: {
        ...this.environment, PYTHONUTF8: "1", PYTHONUNBUFFERED: "1", HF_HOME: this.config.modelCachePath,
        TUBEKNOWLEDGE_FFMPEG_PATH: this.config.ffmpegPath, TUBEKNOWLEDGE_FFPROBE_PATH: this.config.ffprobePath,
      },
      onSpawn: (child) => this.active.set(job.id, child),
      onEvent: (event, raw) => this.handleEvent(job, event, raw),
    });
    try { return (await runner.promise).result; }
    finally { this.active.delete(job.id); }
  }

  private async handleEvent(job: AcquisitionJob, event: WorkerEvent, raw: string): Promise<void> {
    await appendEventLog(this.config, job.id, raw);
    if (event.type === "started") {
      job.stage = event.stage; job.status = statusForStage(event.stage, job.status); job.progress = null;
    } else if (event.type === "progress") {
      job.stage = event.stage; job.status = statusForStage(event.stage, job.status); job.progress = event.progress ?? null; job.message = event.message;
    } else if (event.type === "warning") {
      job.warnings.push({ code: event.code, message: event.message });
    } else if (event.type === "artifact") {
      const normalized = event.relativePath.replaceAll("\\", "/");
      const name = path.posix.basename(normalized);
      if (!normalized.startsWith("output/") || !ARTIFACT_ALLOWLIST.has(name)) throw new Error("Artifact worker non autorisé.");
      if (!job.artifacts.some((artifact) => artifact.name === name)) job.artifacts.push({ kind: event.kind, name });
    } else if (event.type === "failed") {
      const safe = normalizePublicError(workerFailure(event.code, event.message), "WORKER_FAILED").payload;
      job.error = safe;
      job.message = safe.message;
    }
    await saveJob(this.config, job);
  }

  private async complete(job: AcquisitionJob): Promise<void> {
    const current = await loadJob(this.config, job.id);
    if (current.status === "canceled") return;
    current.status = "completed"; current.stage = "completed"; current.progress = 1; current.message = "Acquisition terminée."; delete current.error;
    await saveJob(this.config, current);
  }

  private async fail(job: AcquisitionJob, code: PublicTranscriptionErrorCode, error: unknown): Promise<void> {
    const current = await loadJob(this.config, job.id);
    if (current.status === "canceled") return;
    current.status = "failed"; current.stage = "failed"; current.progress = null;
    current.error = normalizePublicError(error, code).payload;
    current.message = current.error.message;
    await saveJob(this.config, current);
  }

  private async cleanupPartials(id: string): Promise<void> {
    const directory = jobDirectory(this.config, id);
    await Promise.all([rm(path.join(directory, "work"), { recursive: true, force: true }), rm(path.join(directory, "raw"), { recursive: true, force: true })]);
    await Promise.all([mkdir(path.join(directory, "work"), { recursive: true }), mkdir(path.join(directory, "raw"), { recursive: true })]);
  }

  private async writeSource(job: AcquisitionJob): Promise<void> {
    const source = { schemaVersion: 1, type: job.source?.type, videoId: job.source?.videoId, canonicalUrl: job.source?.canonicalUrl, originalName: job.source?.originalName, title: job.title };
    await writeFile(path.join(jobDirectory(this.config, job.id), "source.json"), `${JSON.stringify(source, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  private readonlyView(job: AcquisitionJob): AcquisitionJob {
    if (!ACTIVE_AFTER_RESTART.has(job.status) || this.running.has(job.id) || this.active.has(job.id)) return job;
    return { ...job, status: "interrupted", stage: "interrupted", progress: null, message: "Traitement interrompu par le redémarrage de l’application." };
  }
}

const globalManagers = globalThis as typeof globalThis & { tubeKnowledgeAcquisitionManager?: AcquisitionManager };

export function getAcquisitionManager(): AcquisitionManager {
  globalManagers.tubeKnowledgeAcquisitionManager ??= new AcquisitionManager();
  return globalManagers.tubeKnowledgeAcquisitionManager;
}
