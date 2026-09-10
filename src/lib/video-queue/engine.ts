import { randomUUID } from "node:crypto";

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { getAcquisitionManager, type AcquisitionManager } from "@/lib/transcription/manager";
import { validateYoutubeUrl } from "@/lib/transcription/youtube-url";
import { advanceSimpleModeWorkflow } from "@/lib/simple-mode/automation";
import {
  cancelVideoKnowledgeWorkflow,
  createVideoKnowledgeWorkflow,
  detectWorkflowDuplicates,
  inspectVideoKnowledgeWorkflow,
  loadWorkflow,
  resumeWorkflowAcquisition,
  synchronizeWorkflow,
  updateWorkflow,
  type WorkflowDuplicate,
  type WorkflowOrchestratorOptions,
} from "@/lib/workflows/orchestrator";
import type { VideoKnowledgeWorkflow } from "@/lib/workflows/schema";

import { VideoQueueError } from "./errors";
import {
  VIDEO_QUEUE_COMMAND_LIMIT,
  VIDEO_QUEUE_HISTORY_LIMIT,
  hashQueueRequest,
  loadVideoQueueStore,
  videoQueueRuntimePath,
  acquireVideoQueueRunnerLock,
  withLockedVideoQueue,
} from "./runtime";
import {
  addVideosCommandSchema,
  idempotentCommandSchema,
  type VideoQueueItem,
  type VideoQueueItemState,
  type VideoQueueStore,
} from "./schema";

export interface QueueDuplicateView {
  kind: "submission" | "queue" | "workflow" | "acquisition" | "library";
  itemId?: string;
  workflowId?: string;
  imported: boolean;
}

export interface AddVideoResult {
  inputIndex: number;
  status: "accepted" | "duplicate" | "rejected";
  itemId?: string;
  canonicalUrl?: string;
  videoId?: string;
  duplicates?: QueueDuplicateView[];
  errorCode?: "INVALID_YOUTUBE_URL";
}

export interface VideoQueueSnapshot {
  revision: number;
  paused: boolean;
  activeItemId: string | null;
  items: VideoQueueItem[];
  history: VideoQueueStore["history"];
}

export interface QueueWorkflowAdapter {
  detectDuplicates(canonicalUrl: string): Promise<WorkflowDuplicate[]>;
  create(canonicalUrl: string, workflowId: string): Promise<VideoKnowledgeWorkflow>;
  inspect(workflowId: string): Promise<VideoKnowledgeWorkflow>;
  load(workflowId: string): Promise<VideoKnowledgeWorkflow>;
  synchronize(workflowId: string): Promise<VideoKnowledgeWorkflow>;
  retry(workflowId: string): Promise<VideoKnowledgeWorkflow>;
  cancel(workflowId: string): Promise<VideoKnowledgeWorkflow>;
  advance?(workflowId: string): Promise<VideoKnowledgeWorkflow>;
  interruptAnalysis?(workflowId: string): Promise<VideoKnowledgeWorkflow>;
}

export interface VideoQueueEngineOptions {
  environment?: LibraryEnvironment;
  processEnvironment?: NodeJS.ProcessEnv;
  root?: string;
  workflowRoot?: string;
  manager?: Pick<AcquisitionManager, "inspect" | "start" | "resume" | "cancel" | "get" | "list">;
  adapter?: QueueWorkflowAdapter;
  now?: () => Date;
  autoProcess?: boolean;
  runnerIntervalMs?: number;
}

function publicSnapshot(store: VideoQueueStore): VideoQueueSnapshot {
  return {
    revision: store.revision,
    paused: store.paused,
    activeItemId: store.activeItemId,
    items: structuredClone(store.items),
    history: structuredClone(store.history),
  };
}

function safeFailureCode(error: unknown, fallback: string): string {
  const value = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  return typeof value === "string" && /^[A-Z0-9_]{1,80}$/.test(value) ? value : fallback;
}

function isMissingWorkflow(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
}

function workflowState(workflow: VideoKnowledgeWorkflow): { state: VideoQueueItemState; pauseReason?: "source-selection-required" } {
  if (workflow.state === "draft" || workflow.state === "inspecting") return { state: "inspecting" };
  if (workflow.lastErrorCode && workflow.state !== "failed") return { state: "result-ready" };
  if (workflow.state === "source-selection") return { state: "paused", pauseReason: "source-selection-required" };
  if (workflow.state === "acquiring") return { state: "transcribing" };
  if (workflow.state === "transcript-ready") return { state: "transcript-ready" };
  if (["analysis-preparing", "analysis-ready", "awaiting-result"].includes(workflow.state)) return { state: "analysis-required" };
  if (["result-received", "preview-ready", "blocked-reader", "blocked-conflict"].includes(workflow.state)) return { state: "result-ready" };
  if (workflow.state === "imported") return { state: "imported" };
  if (workflow.state === "canceled") return { state: "cancelled" };
  return { state: "failed" };
}

function defaultAdapter(options: VideoQueueEngineOptions): QueueWorkflowAdapter {
  const processEnvironment = options.processEnvironment ?? process.env;
  const manager = options.manager ?? getAcquisitionManager();
  const base: WorkflowOrchestratorOptions = {
    environment: options.environment,
    processEnvironment,
    root: options.workflowRoot,
    manager,
    now: options.now,
  };
  return {
    detectDuplicates: (canonicalUrl) => detectWorkflowDuplicates(canonicalUrl, base),
    create: (canonicalUrl, workflowId) => createVideoKnowledgeWorkflow({ sourceUrl: canonicalUrl }, { ...base, workflowId }).then((value) => value.workflow),
    inspect: (workflowId) => inspectVideoKnowledgeWorkflow(workflowId, base),
    load: (workflowId) => loadWorkflow(workflowId, options.workflowRoot),
    synchronize: (workflowId) => synchronizeWorkflow(workflowId, base),
    advance: (workflowId) => advanceSimpleModeWorkflow(workflowId, processEnvironment),
    interruptAnalysis: (workflowId) => updateWorkflow(workflowId, {
      lastErrorCode: "AI_ANALYSIS_INTERRUPTED",
      nextAction: "Vérification nécessaire : relancez explicitement l’analyse automatique.",
    }, { root: options.workflowRoot, now: options.now?.() }),
    retry: async (workflowId) => {
      const workflow = await loadWorkflow(workflowId, options.workflowRoot);
      return workflow.acquisitionId ? resumeWorkflowAcquisition(workflowId, base) : inspectVideoKnowledgeWorkflow(workflowId, base);
    },
    cancel: (workflowId) => cancelVideoKnowledgeWorkflow(workflowId, base),
  };
}

export class VideoQueueEngine {
  private readonly root: string;
  private readonly adapter: QueueWorkflowAdapter;
  private readonly now: () => Date;
  private readonly autoProcess: boolean;
  private readonly runnerIntervalMs: number;
  private processing: Promise<void> | null = null;
  private runnerTimer: ReturnType<typeof setTimeout> | null = null;
  private runnerEnabled = false;
  private runnerInFlight: Promise<void> | null = null;

  constructor(options: VideoQueueEngineOptions = {}) {
    this.root = options.root ?? videoQueueRuntimePath(options.processEnvironment);
    this.adapter = options.adapter ?? defaultAdapter(options);
    this.now = options.now ?? (() => new Date());
    this.autoProcess = options.autoProcess ?? true;
    this.runnerIntervalMs = options.runnerIntervalMs ?? 1_000;
  }

  async snapshot(): Promise<VideoQueueSnapshot> {
    return publicSnapshot(await loadVideoQueueStore(this.root));
  }

  private transition(store: VideoQueueStore, item: VideoQueueItem, to: VideoQueueItemState, reasonCode: string, changes: Partial<VideoQueueItem> = {}): void {
    const from = item.state;
    Object.assign(item, changes, { state: to, updatedAt: this.now().toISOString() });
    if (to !== "paused") { delete item.pauseReason; delete item.resumeState; }
    if (from !== to || changes.lastErrorCode !== undefined) {
      store.history.push({ eventId: randomUUID(), itemId: item.itemId, at: this.now().toISOString(), from, to, reasonCode });
      store.history = store.history.slice(-VIDEO_QUEUE_HISTORY_LIMIT);
    }
  }

  private async command<T extends object>(
    idempotencyKey: string,
    command: "add" | "pause" | "resume" | "cancel" | "retry" | "reconcile",
    request: unknown,
    operation: (store: VideoQueueStore) => Promise<T> | T,
    resultPolicy: {
      persist: (result: T) => unknown;
      replay: (persisted: unknown, store: VideoQueueStore) => T;
    },
  ): Promise<T> {
    const requestHash = hashQueueRequest({ command, request });
    return withLockedVideoQueue(async (store) => {
      const prior = store.commands.find((entry) => entry.idempotencyKey === idempotencyKey);
      if (prior) {
        if (prior.command !== command || prior.requestHash !== requestHash) throw new VideoQueueError("QUEUE_COMMAND_CONFLICT");
        return { store, value: resultPolicy.replay(prior.result, store) };
      }
      const result = await operation(store);
      const persistedResult = JSON.parse(JSON.stringify(result)) as T;
      const compactResult = JSON.parse(JSON.stringify(resultPolicy.persist(persistedResult))) as VideoQueueStore["commands"][number]["result"];
      store.commands.push({ idempotencyKey, command, requestHash, completedAt: this.now().toISOString(), result: compactResult });
      store.commands = store.commands.slice(-VIDEO_QUEUE_COMMAND_LIMIT);
      return { store, value: persistedResult };
    }, { root: this.root, now: this.now });
  }

  async add(input: unknown): Promise<{ results: AddVideoResult[]; queue: VideoQueueSnapshot }> {
    const request = addVideosCommandSchema.parse(input);
    const result = await this.command(request.idempotencyKey, "add", request.urls, async (store) => {
      const results: AddVideoResult[] = [];
      const submitted = new Map<string, number>();
      for (const [inputIndex, rawUrl] of request.urls.entries()) {
        let validated;
        try { validated = validateYoutubeUrl(rawUrl); }
        catch { results.push({ inputIndex, status: "rejected", errorCode: "INVALID_YOUTUBE_URL" }); continue; }
        const firstIndex = submitted.get(validated.videoId);
        if (firstIndex !== undefined) {
          results.push({ inputIndex, status: "duplicate", canonicalUrl: validated.canonicalUrl, videoId: validated.videoId, duplicates: [{ kind: "submission", imported: false }] });
          continue;
        }
        submitted.set(validated.videoId, inputIndex);
        const queued = store.items.find((item) => item.videoId === validated.videoId);
        if (queued) {
          results.push({ inputIndex, status: "duplicate", canonicalUrl: validated.canonicalUrl, videoId: validated.videoId, duplicates: [{ kind: "queue", itemId: queued.itemId, workflowId: queued.workflowId, imported: queued.state === "imported" }] });
          continue;
        }
        const existing = await this.adapter.detectDuplicates(validated.canonicalUrl);
        if (existing.length) {
          results.push({ inputIndex, status: "duplicate", canonicalUrl: validated.canonicalUrl, videoId: validated.videoId, duplicates: existing.map((entry) => ({ kind: entry.kind, workflowId: entry.workflowId, imported: entry.imported })) });
          continue;
        }
        const now = this.now().toISOString();
        const item: VideoQueueItem = {
          itemId: randomUUID(), createdAt: now, updatedAt: now, canonicalUrl: validated.canonicalUrl,
          videoId: validated.videoId, state: store.paused ? "paused" : "queued", attemptCount: 0,
          ...(store.paused ? { pauseReason: "global" as const, resumeState: "queued" as const } : {}),
        };
        store.items.push(item);
        store.history.push({ eventId: randomUUID(), itemId: item.itemId, at: now, to: item.state, reasonCode: store.paused ? "ADDED_WHILE_PAUSED" : "ADDED" });
        store.history = store.history.slice(-VIDEO_QUEUE_HISTORY_LIMIT);
        results.push({ inputIndex, status: "accepted", itemId: item.itemId, canonicalUrl: item.canonicalUrl, videoId: item.videoId });
      }
      return { results, queue: publicSnapshot(store) };
    }, {
      persist: (value) => ({ results: value.results }),
      replay: (value, store) => ({ results: (value as { results: AddVideoResult[] }).results, queue: publicSnapshot(store) }),
    });
    if (this.autoProcess && result.results.some((entry) => entry.status === "accepted")) void this.start();
    return result;
  }

  async pause(input: unknown): Promise<VideoQueueSnapshot> {
    const request = idempotentCommandSchema.parse(input);
    return this.command(request.idempotencyKey, "pause", {}, (store) => {
      store.paused = true;
      for (const item of store.items) if (item.state === "queued") this.transition(store, item, "paused", "GLOBAL_PAUSE", { pauseReason: "global", resumeState: "queued" });
      return publicSnapshot(store);
    }, { persist: () => ({}), replay: (_value, store) => publicSnapshot(store) });
  }

  async resume(input: unknown): Promise<VideoQueueSnapshot> {
    const request = idempotentCommandSchema.parse(input);
    const result = await this.command(request.idempotencyKey, "resume", {}, (store) => {
      store.paused = false;
      for (const item of store.items) if (item.state === "paused" && item.pauseReason === "global") this.transition(store, item, item.resumeState ?? "queued", "GLOBAL_RESUME");
      return publicSnapshot(store);
    }, { persist: () => ({}), replay: (_value, store) => publicSnapshot(store) });
    if (this.autoProcess) void this.start();
    return result;
  }

  async cancel(itemId: string, input: unknown): Promise<VideoQueueSnapshot> {
    const request = idempotentCommandSchema.parse(input);
    return this.command(request.idempotencyKey, "cancel", { itemId }, async (store) => {
      const item = store.items.find((entry) => entry.itemId === itemId);
      if (!item) throw new VideoQueueError("QUEUE_ITEM_NOT_FOUND");
      if (item.state === "imported") throw new VideoQueueError("QUEUE_INVALID_STATE");
      const workflowCanBeCancelled = ["queued", "inspecting", "transcribing", "paused", "failed", "transcript-ready", "analysis-required"].includes(item.state);
      if (item.state !== "cancelled" && item.workflowId && workflowCanBeCancelled) await this.adapter.cancel(item.workflowId);
      if (item.state !== "cancelled") this.transition(store, item, "cancelled", "CANCELLED_BY_USER");
      if (store.activeItemId === itemId) store.activeItemId = null;
      return publicSnapshot(store);
    }, { persist: () => ({}), replay: (_value, store) => publicSnapshot(store) });
  }

  async retry(itemId: string, input: unknown): Promise<VideoQueueSnapshot> {
    const request = idempotentCommandSchema.parse(input);
    const result = await this.command(request.idempotencyKey, "retry", { itemId }, async (store) => {
      const item = store.items.find((entry) => entry.itemId === itemId);
      if (!item) throw new VideoQueueError("QUEUE_ITEM_NOT_FOUND");
      if (item.state !== "failed") throw new VideoQueueError("QUEUE_INVALID_STATE");
      // Une inspection peut échouer avant qu'une acquisition soit créée. Dans ce
      // cas, repasser par la boucle de file préserve sa sérialisation et son
      // compteur de tentatives, au lieu de tenter de reprendre une acquisition
      // inexistante.
      let existingWorkflow: VideoKnowledgeWorkflow | null = null;
      if (item.workflowId) {
        try { existingWorkflow = await this.adapter.load(item.workflowId); }
        catch (error) {
          if (!isMissingWorkflow(error)) throw error;
          delete item.workflowId;
        }
      }
      const retried = existingWorkflow?.acquisitionId ? await this.adapter.retry(existingWorkflow.workflowId) : null;
      delete item.lastErrorCode;
      if (retried) this.applyWorkflow(store, item, retried, "EXPLICIT_RETRY");
      else this.transition(store, item, store.paused ? "paused" : "queued", "EXPLICIT_RETRY", store.paused ? { pauseReason: "global", resumeState: "queued" } : {});
      return publicSnapshot(store);
    }, { persist: () => ({}), replay: (_value, store) => publicSnapshot(store) });
    if (this.autoProcess) void this.start();
    return result;
  }

  async reconcile(input: unknown): Promise<VideoQueueSnapshot> {
    // Cette ancienne commande reste compatible côté API, mais elle ne peut plus
    // faire avancer un workflow dans le contexte d'une page. Le runner verrouillé
    // est la seule autorité de progression.
    idempotentCommandSchema.parse(input);
    if (this.autoProcess) void this.start();
    return this.snapshot();
  }

  async start(): Promise<void> {
    if (this.processing) return this.processing;
    this.processing = this.runWithRunnerLock().finally(() => { this.processing = null; });
    return this.processing;
  }

  private async runWithRunnerLock(): Promise<void> {
    const lock = await acquireVideoQueueRunnerLock(this.root, this.now);
    if (!lock) return;
    try { await this.runLoop(); }
    finally { await lock.release(); }
  }

  /** Démarre le moteur serveur; il n'est relié ni à une page ni à un navigateur. */
  startBackgroundRunner(): void {
    if (this.runnerEnabled) return;
    this.runnerEnabled = true;
    const tick = async (): Promise<void> => {
      try {
        await this.start();
      } catch {
        // Les erreurs métier sont persistées par la boucle; un verrou temporaire
        // laisse simplement le prochain tick reprendre la main.
      } finally {
        if (this.runnerEnabled) {
          this.runnerTimer = setTimeout(() => { this.scheduleRunnerTick(tick); }, this.runnerIntervalMs);
          this.runnerTimer.unref?.();
        }
      }
    };
    this.scheduleRunnerTick(tick);
  }

  async stopBackgroundRunner(): Promise<void> {
    this.runnerEnabled = false;
    if (this.runnerTimer) clearTimeout(this.runnerTimer);
    this.runnerTimer = null;
    await this.runnerInFlight;
  }

  private scheduleRunnerTick(tick: () => Promise<void>): void {
    const running = tick().finally(() => {
      if (this.runnerInFlight === running) this.runnerInFlight = null;
    });
    this.runnerInFlight = running;
  }

  private async recoverAfterRestart(): Promise<void> {
    const snapshot = await this.snapshot();
    const active = snapshot.activeItemId ? snapshot.items.find((item) => item.itemId === snapshot.activeItemId) : undefined;
    if (!active) {
      if (snapshot.activeItemId) await withLockedVideoQueue((store) => ({ store: { ...store, activeItemId: null }, value: undefined }), { root: this.root, now: this.now });
      return;
    }
    let workflow: VideoKnowledgeWorkflow | null = null;
    try { workflow = await this.adapter.load(active.workflowId ?? active.itemId); } catch { /* crash possible avant création du workflow */ }
    if (workflow?.state === "analysis-preparing" && this.adapter.interruptAnalysis) workflow = await this.adapter.interruptAnalysis(workflow.workflowId);
    await withLockedVideoQueue((store) => {
      const item = store.items.find((entry) => entry.itemId === active.itemId);
      if (!item) return { store: { ...store, activeItemId: null }, value: undefined };
      if (workflow) {
        item.workflowId = workflow.workflowId;
        this.applyWorkflow(store, item, workflow, "RESTART_RECOVERY");
        if (workflow.state === "draft" || workflow.state === "inspecting") this.transition(store, item, "queued", "RESTART_REQUEUED");
      } else if (item.state === "inspecting") this.transition(store, item, "queued", "RESTART_REQUEUED");
      // Seules les étapes déterministes sont reprises automatiquement. Une analyse
      // interrompue reste explicitement vérifiable, sans rejouer un Apply commité.
      const resumableInterrupted = workflow?.state === "failed" && workflow.lastErrorCode === "TRANSCRIPTION_INTERRUPTED";
      const resumableAutomaticStep = workflow?.state === "source-selection" || workflow?.state === "transcript-ready";
      store.activeItemId = resumableInterrupted || resumableAutomaticStep || ["inspecting", "transcribing"].includes(item.state) ? item.itemId : null;
      return { store, value: undefined };
    }, { root: this.root, now: this.now });
  }

  private async runLoop(): Promise<void> {
    await this.recoverAfterRestart();
    while (true) {
      const advanced = await this.advanceActiveItem();
      if (advanced) {
        if ((await this.snapshot()).activeItemId) return;
        continue;
      }
      const item = await withLockedVideoQueue((store) => {
        if (store.paused || store.activeItemId) return { store, value: null as VideoQueueItem | null };
        const next = store.items.find((entry) => entry.state === "queued");
        if (!next) return { store, value: null as VideoQueueItem | null };
        this.transition(store, next, "inspecting", "PROCESSING_STARTED", { attemptCount: next.attemptCount + 1 });
        store.activeItemId = next.itemId;
        return { store, value: structuredClone(next) };
      }, { root: this.root, now: this.now });
      if (!item) return;
      await this.inspectItem(item);
    }
  }

  private async inspectItem(claimed: VideoQueueItem): Promise<void> {
    try {
      let workflow: VideoKnowledgeWorkflow;
      try { workflow = await this.adapter.load(claimed.workflowId ?? claimed.itemId); }
      catch { workflow = await this.adapter.create(claimed.canonicalUrl, claimed.itemId); }
      await withLockedVideoQueue((store) => {
        const item = store.items.find((entry) => entry.itemId === claimed.itemId);
        if (item && item.state !== "cancelled") item.workflowId = workflow.workflowId;
        return { store, value: undefined };
      }, { root: this.root, now: this.now });
      workflow = await this.adapter.inspect(workflow.workflowId);
      if (this.adapter.advance) workflow = await this.adapter.advance(workflow.workflowId);
      await withLockedVideoQueue((store) => {
        const item = store.items.find((entry) => entry.itemId === claimed.itemId);
        if (item && item.state !== "cancelled") this.applyWorkflow(store, item, workflow, "INSPECTION_COMPLETED");
        return { store, value: undefined };
      }, { root: this.root, now: this.now });
    } catch (error) {
      await withLockedVideoQueue((store) => {
        const item = store.items.find((entry) => entry.itemId === claimed.itemId);
        if (item && item.state !== "cancelled") this.transition(store, item, "failed", "PROCESSING_FAILED", { lastErrorCode: safeFailureCode(error, "QUEUE_INSPECTION_FAILED") });
        if (store.activeItemId === claimed.itemId) store.activeItemId = null;
        return { store, value: undefined };
      }, { root: this.root, now: this.now });
    }
  }

  private async advanceActiveItem(): Promise<boolean> {
    const snapshot = await this.snapshot();
    const active = snapshot.activeItemId ? snapshot.items.find((item) => item.itemId === snapshot.activeItemId) : undefined;
    if (!active) return false;
    if (!active.workflowId) {
      await withLockedVideoQueue((store) => {
        const item = store.items.find((entry) => entry.itemId === active.itemId);
        if (item) this.transition(store, item, "failed", "RUNNER_WORKFLOW_MISSING", { lastErrorCode: "QUEUE_WORKFLOW_MISSING" });
        if (store.activeItemId === active.itemId) store.activeItemId = null;
        return { store, value: undefined };
      }, { root: this.root, now: this.now });
      return true;
    }
    try {
      let workflow = await this.adapter.synchronize(active.workflowId);
      if (workflow.state === "failed" && workflow.lastErrorCode === "TRANSCRIPTION_INTERRUPTED") {
        workflow = await this.adapter.retry(workflow.workflowId);
      } else if (this.adapter.advance) {
        workflow = await this.adapter.advance(workflow.workflowId);
      }
      await withLockedVideoQueue((store) => {
        const item = store.items.find((entry) => entry.itemId === active.itemId);
        if (item && item.state !== "cancelled") this.applyWorkflow(store, item, workflow, "BACKGROUND_RECONCILED");
        return { store, value: undefined };
      }, { root: this.root, now: this.now });
    } catch (error) {
      await withLockedVideoQueue((store) => {
        const item = store.items.find((entry) => entry.itemId === active.itemId);
        if (item && item.state !== "cancelled") this.transition(store, item, "failed", "BACKGROUND_FAILED", { lastErrorCode: safeFailureCode(error, "QUEUE_BACKGROUND_FAILED") });
        if (store.activeItemId === active.itemId) store.activeItemId = null;
        return { store, value: undefined };
      }, { root: this.root, now: this.now });
    }
    return true;
  }

  private applyWorkflow(store: VideoQueueStore, item: VideoQueueItem, workflow: VideoKnowledgeWorkflow, reasonCode: string): void {
    const mapped = workflowState(workflow);
    item.workflowId = workflow.workflowId;
    if (workflow.title) item.title = workflow.title;
    const changes: Partial<VideoQueueItem> = { lastErrorCode: workflow.lastErrorCode };
    if (mapped.state === "paused") Object.assign(changes, { pauseReason: mapped.pauseReason, resumeState: "transcribing" as const });
    this.transition(store, item, mapped.state, reasonCode, changes);
    if (mapped.state === "inspecting" || mapped.state === "transcribing") store.activeItemId ??= item.itemId;
    else if (store.activeItemId === item.itemId) store.activeItemId = null;
  }
}

let singleton: VideoQueueEngine | undefined;
export function getVideoQueueEngine(): VideoQueueEngine {
  singleton ??= new VideoQueueEngine();
  return singleton;
}
