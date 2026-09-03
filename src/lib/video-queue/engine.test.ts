import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { assertSameOrigin } from "@/lib/imports/http";
import type { WorkflowDuplicate } from "@/lib/workflows/orchestrator";
import { nextActionForState, type VideoKnowledgeWorkflow, type WorkflowState } from "@/lib/workflows/schema";

import { VideoQueueEngine, type QueueWorkflowAdapter } from "./engine";
import { publicVideoQueueError } from "./errors";
import { loadVideoQueueStore, saveVideoQueueStore } from "./runtime";
import { addVideosCommandSchema } from "./schema";

const roots: string[] = [];
const firstUrl = "https://www.youtube.com/watch?v=abcDEF_1234";
const secondUrl = "https://youtu.be/xyzABC_9876?si=tracking-secret";

async function tempRoot(prefix = "tk-phase11a-") {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function workflow(id: string, sourceUrl: string, state: WorkflowState, changes: Partial<VideoKnowledgeWorkflow> = {}): VideoKnowledgeWorkflow {
  const now = "2026-07-28T12:00:00.000Z";
  return {
    schemaVersion: 1, workflowId: id, createdAt: now, updatedAt: now, state, sourceUrl,
    videoId: new URL(sourceUrl).searchParams.get("v") ?? undefined,
    nextAction: nextActionForState(state), reprocessingApproved: false, knowledgePaths: [], ...changes,
  };
}

class FakeWorkflowAdapter implements QueueWorkflowAdapter {
  readonly workflows = new Map<string, VideoKnowledgeWorkflow>();
  readonly duplicates = new Map<string, WorkflowDuplicate[]>();
  readonly calls = { create: 0, inspect: 0, retry: 0, cancel: 0, synchronize: 0 };
  inFlight = 0;
  maxInFlight = 0;
  inspectFailure: unknown = null;

  async detectDuplicates(canonicalUrl: string) { return this.duplicates.get(canonicalUrl) ?? []; }
  async create(canonicalUrl: string, workflowId: string) {
    this.calls.create++;
    const value = workflow(workflowId, canonicalUrl, "draft");
    this.workflows.set(workflowId, value);
    return value;
  }
  async inspect(workflowId: string) {
    this.calls.inspect++;
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 3));
    this.inFlight--;
    if (this.inspectFailure) throw this.inspectFailure;
    const current = await this.load(workflowId);
    const value = workflow(workflowId, current.sourceUrl, "source-selection", { title: `Fixture ${workflowId.slice(0, 4)}` });
    this.workflows.set(workflowId, value);
    return value;
  }
  async load(workflowId: string) {
    const value = this.workflows.get(workflowId);
    if (!value) throw Object.assign(new Error("absent"), { code: "ENOENT" });
    return value;
  }
  async synchronize(workflowId: string) { this.calls.synchronize++; return this.load(workflowId); }
  async retry(workflowId: string) {
    this.calls.retry++;
    const current = await this.load(workflowId);
    const value = workflow(workflowId, current.sourceUrl, current.acquisitionId ? "acquiring" : "source-selection", current.acquisitionId ? { acquisitionId: current.acquisitionId } : {});
    this.workflows.set(workflowId, value);
    return value;
  }
  async cancel(workflowId: string) {
    this.calls.cancel++;
    const current = await this.load(workflowId);
    const value = workflow(workflowId, current.sourceUrl, "canceled");
    this.workflows.set(workflowId, value);
    return value;
  }
}

async function add(engine: VideoQueueEngine, urls = [firstUrl], key = "command:add:0001") {
  return engine.add({ idempotencyKey: key, urls });
}

function hash(value: Buffer | string) { return createHash("sha256").update(value).digest("hex"); }

describe("moteur local persistant de file vidéo", () => {
  it("canonicalise watch, youtu.be, shorts et supprime les paramètres de tracking", async () => {
    const root = await tempRoot(); const adapter = new FakeWorkflowAdapter(); const engine = new VideoQueueEngine({ root, adapter, autoProcess: false });
    const result = await add(engine, [
      "https://youtube.com/watch?v=abcDEF_1234&utm_source=test",
      "https://youtu.be/xyzABC_9876?si=secret",
      "https://www.youtube.com/shorts/QWEasd_4567?feature=share",
    ]);
    expect(result.results.map((entry) => entry.canonicalUrl)).toEqual([
      "https://www.youtube.com/watch?v=abcDEF_1234",
      "https://www.youtube.com/watch?v=xyzABC_9876",
      "https://www.youtube.com/watch?v=QWEasd_4567",
    ]);
    expect(JSON.stringify(result)).not.toContain("tracking-secret");
  });

  it("ajoute plusieurs URL, refuse l’invalide et détecte un doublon de soumission", async () => {
    const root = await tempRoot(); const engine = new VideoQueueEngine({ root, adapter: new FakeWorkflowAdapter(), autoProcess: false });
    const result = await add(engine, [firstUrl, "https://youtu.be/abcDEF_1234?si=x", "https://example.test/video", secondUrl]);
    expect(result.results.map((entry) => entry.status)).toEqual(["accepted", "duplicate", "rejected", "accepted"]);
    expect((await engine.snapshot()).items).toHaveLength(2);
  });

  it("détecte les doublons de file, workflow existant et vidéo déjà analysée", async () => {
    const root = await tempRoot(); const adapter = new FakeWorkflowAdapter(); const engine = new VideoQueueEngine({ root, adapter, autoProcess: false });
    await add(engine);
    expect((await add(engine, [firstUrl], "command:add:0002")).results[0]).toMatchObject({ status: "duplicate", duplicates: [{ kind: "queue" }] });
    const workflowUrl = "https://www.youtube.com/watch?v=workflw_123";
    adapter.duplicates.set(workflowUrl, [{ kind: "workflow", title: "Existant", workflowId: "11111111-1111-4111-8111-111111111111", imported: false }]);
    expect((await add(engine, [workflowUrl], "command:add:0003")).results[0]).toMatchObject({ status: "duplicate", duplicates: [{ kind: "workflow", workflowId: "11111111-1111-4111-8111-111111111111" }] });
    const importedUrl = "https://www.youtube.com/watch?v=library_1234";
    adapter.duplicates.set(importedUrl, [{ kind: "library", title: "videos.md", imported: true }]);
    expect((await add(engine, [importedUrl], "command:add:0004")).results[0]).toMatchObject({ status: "duplicate", duplicates: [{ kind: "library", imported: true }] });
  });

  it("traite les inspections avec une concurrence strictement égale à 1", async () => {
    const root = await tempRoot(); const adapter = new FakeWorkflowAdapter(); const engine = new VideoQueueEngine({ root, adapter, autoProcess: false });
    await add(engine, [firstUrl, secondUrl]);
    await Promise.all([engine.start(), engine.start(), engine.start()]);
    expect(adapter.maxInFlight).toBe(1);
    expect(adapter.calls.inspect).toBe(2);
    expect((await engine.snapshot()).items.every((item) => item.state === "paused" && item.pauseReason === "source-selection-required")).toBe(true);
  });

  it("reprend le backlog après redémarrage avec le même stockage", async () => {
    const root = await tempRoot(); const adapter = new FakeWorkflowAdapter();
    await add(new VideoQueueEngine({ root, adapter, autoProcess: false }), [firstUrl, secondUrl]);
    const restarted = new VideoQueueEngine({ root, adapter, autoProcess: false });
    await restarted.start();
    expect((await restarted.snapshot()).items).toHaveLength(2);
    expect(adapter.calls.create).toBe(2);
  });

  it("récupère un crash entre la revendication et la création, puis entre la création et le lien", async () => {
    const root = await tempRoot(); const adapter = new FakeWorkflowAdapter(); const first = await add(new VideoQueueEngine({ root, adapter, autoProcess: false }));
    const itemId = first.results[0].itemId!;
    const store = await loadVideoQueueStore(root); const item = store.items[0]; item.state = "inspecting"; store.activeItemId = itemId; await saveVideoQueueStore(store, root);
    await new VideoQueueEngine({ root, adapter, autoProcess: false }).start();
    expect((await loadVideoQueueStore(root)).items[0].workflowId).toBe(itemId);

    const rootTwo = await tempRoot(); const adapterTwo = new FakeWorkflowAdapter(); const second = await add(new VideoQueueEngine({ root: rootTwo, adapter: adapterTwo, autoProcess: false }));
    const secondId = second.results[0].itemId!; const secondStore = await loadVideoQueueStore(rootTwo); secondStore.items[0].state = "inspecting"; secondStore.activeItemId = secondId; await saveVideoQueueStore(secondStore, rootTwo);
    adapterTwo.workflows.set(secondId, workflow(secondId, firstUrl, "draft"));
    await new VideoQueueEngine({ root: rootTwo, adapter: adapterTwo, autoProcess: false }).start();
    expect(adapterTwo.calls.create).toBe(0);
    expect((await loadVideoQueueStore(rootTwo)).items[0].workflowId).toBe(secondId);
  });

  it("persiste pause et reprise globales sans interrompre une action humaine", async () => {
    const root = await tempRoot(); const adapter = new FakeWorkflowAdapter(); const engine = new VideoQueueEngine({ root, adapter, autoProcess: false });
    await add(engine);
    expect((await engine.pause({ idempotencyKey: "command:pause:01" })).items[0]).toMatchObject({ state: "paused", pauseReason: "global" });
    const resumed = await engine.resume({ idempotencyKey: "command:resume:1" });
    expect(resumed.paused).toBe(false); expect(resumed.items[0].state).toBe("queued");
    await engine.start();
    const humanPause = await engine.pause({ idempotencyKey: "command:pause:02" });
    expect(humanPause.items[0].pauseReason).toBe("source-selection-required");
    expect((await engine.resume({ idempotencyKey: "command:resume:2" })).items[0].pauseReason).toBe("source-selection-required");
  });

  it("annule un élément, relie le workflow et rejoue la commande sans double effet", async () => {
    const root = await tempRoot(); const adapter = new FakeWorkflowAdapter(); const engine = new VideoQueueEngine({ root, adapter, autoProcess: false });
    await add(engine); await engine.start(); const item = (await engine.snapshot()).items[0];
    const first = await engine.cancel(item.itemId, { idempotencyKey: "command:cancel:1" });
    const replay = await engine.cancel(item.itemId, { idempotencyKey: "command:cancel:1" });
    expect(first.items[0].state).toBe("cancelled"); expect(replay.items[0].state).toBe("cancelled"); expect(adapter.calls.cancel).toBe(1);
  });

  it("reprend une inspection échouée sans acquisition par la file et ne la rejoue pas", async () => {
    const root = await tempRoot(); const adapter = new FakeWorkflowAdapter(); adapter.inspectFailure = { code: "FIXTURE_FAILURE", privatePath: root };
    const engine = new VideoQueueEngine({ root, adapter, autoProcess: false }); await add(engine); await engine.start();
    const failed = (await engine.snapshot()).items[0]; expect(failed).toMatchObject({ state: "failed", lastErrorCode: "FIXTURE_FAILURE", attemptCount: 1 });
    expect(adapter.workflows.get(failed.workflowId!)?.acquisitionId).toBeUndefined();
    adapter.inspectFailure = null;
    const retried = await engine.retry(failed.itemId, { idempotencyKey: "command:retry:01" });
    expect(retried.items[0]).toMatchObject({ state: "queued", attemptCount: 1 });
    expect(retried.items[0]).not.toHaveProperty("lastErrorCode");
    await engine.start();
    const replay = await engine.retry(failed.itemId, { idempotencyKey: "command:retry:01" });
    expect(replay.items[0]).toMatchObject({ state: "paused", pauseReason: "source-selection-required", attemptCount: 2 });
    expect(adapter.calls.inspect).toBe(2); expect(adapter.calls.retry).toBe(0);
  });

  it("reprend une acquisition échouée sans réinspecter la vidéo", async () => {
    const root = await tempRoot(); const adapter = new FakeWorkflowAdapter(); const engine = new VideoQueueEngine({ root, adapter, autoProcess: false });
    await add(engine); await engine.start(); const item = (await engine.snapshot()).items[0];
    adapter.workflows.set(item.workflowId!, workflow(item.workflowId!, item.canonicalUrl, "failed", { acquisitionId: "22222222-2222-4222-8222-222222222222" }));
    const store = await loadVideoQueueStore(root); store.items[0] = { ...store.items[0], state: "failed", lastErrorCode: "TRANSCRIPTION_INTERRUPTED" }; await saveVideoQueueStore(store, root);
    const retried = await engine.retry(item.itemId, { idempotencyKey: "command:retry:acquisition" });
    expect(retried.items[0].state).toBe("transcribing"); expect(adapter.calls.retry).toBe(1); expect(adapter.calls.inspect).toBe(1);
  });

  it("retire seulement une référence de workflow périmée avant de relancer l’inspection", async () => {
    const root = await tempRoot(); const adapter = new FakeWorkflowAdapter(); const engine = new VideoQueueEngine({ root, adapter, autoProcess: false });
    await add(engine); await engine.start(); const item = (await engine.snapshot()).items[0]; adapter.workflows.delete(item.workflowId!);
    const store = await loadVideoQueueStore(root); store.items[0] = { ...store.items[0], state: "failed", lastErrorCode: "INSPECTION_FAILED" }; await saveVideoQueueStore(store, root);
    const retried = await engine.retry(item.itemId, { idempotencyKey: "command:retry:stale-workflow" });
    expect(retried.items[0]).toMatchObject({ state: "queued", attemptCount: 1 });
    expect(retried.items[0]).not.toHaveProperty("workflowId");
    await engine.start();
    expect((await engine.snapshot()).items[0]).toMatchObject({ state: "paused", workflowId: item.itemId, attemptCount: 2 });
  });

  it("refuse un fichier de file corrompu sans l’écraser", async () => {
    const root = await tempRoot(); await mkdir(root, { recursive: true }); const target = path.join(root, "queue-state.json"); await writeFile(target, "{secret-path:C:\\private", "utf8");
    const before = await readFile(target);
    const error = await new VideoQueueEngine({ root, adapter: new FakeWorkflowAdapter(), autoProcess: false }).snapshot().catch((value) => value);
    expect(publicVideoQueueError(error)).toMatchObject({ code: "QUEUE_STATE_CORRUPT" });
    expect(await readFile(target)).toEqual(before);
  });

  it("rend add idempotent et refuse la réutilisation conflictuelle d’une clé", async () => {
    const root = await tempRoot(); const adapter = new FakeWorkflowAdapter(); const engine = new VideoQueueEngine({ root, adapter, autoProcess: false });
    const first = await add(engine); const statePath = path.join(root, "queue-state.json"); const beforeReplay = hash(await readFile(statePath)); const replay = await add(engine);
    expect(replay.results[0].itemId).toBe(first.results[0].itemId); expect((await engine.snapshot()).items).toHaveLength(1);
    expect(hash(await readFile(statePath))).toBe(beforeReplay);
    await expect(add(engine, [secondUrl])).rejects.toMatchObject({ code: "QUEUE_COMMAND_CONFLICT" });
  });

  it("reflète les états du workflow sans dépasser transcript-ready", async () => {
    const root = await tempRoot(); const adapter = new FakeWorkflowAdapter(); const engine = new VideoQueueEngine({ root, adapter, autoProcess: false });
    await add(engine); await engine.start(); const item = (await engine.snapshot()).items[0];
    adapter.workflows.set(item.workflowId!, workflow(item.workflowId!, item.canonicalUrl, "acquiring", { acquisitionId: "22222222-2222-4222-8222-222222222222" }));
    expect((await engine.reconcile({ idempotencyKey: "command:sync:001" })).items[0].state).toBe("transcribing");
    adapter.workflows.set(item.workflowId!, workflow(item.workflowId!, item.canonicalUrl, "transcript-ready", { acquisitionId: "22222222-2222-4222-8222-222222222222" }));
    const ready = await engine.reconcile({ idempotencyKey: "command:sync:002" });
    expect(ready.items[0].state).toBe("transcript-ready");
    expect(adapter.calls.retry).toBe(0);
  });

  it("reflète analyse requise, résultat prêt et import sans déclencher ces étapes", async () => {
    const root = await tempRoot(); const adapter = new FakeWorkflowAdapter(); const engine = new VideoQueueEngine({ root, adapter, autoProcess: false });
    await add(engine); await engine.start(); const item = (await engine.snapshot()).items[0];
    for (const [index, state, expected] of [
      [1, "analysis-ready", "analysis-required"],
      [2, "preview-ready", "result-ready"],
      [3, "imported", "imported"],
    ] as const) {
      adapter.workflows.set(item.workflowId!, workflow(item.workflowId!, item.canonicalUrl, state));
      const snapshot = await engine.reconcile({ idempotencyKey: `command:later:${index}` });
      expect(snapshot.items[0].state).toBe(expected);
    }
    expect(adapter.calls.retry).toBe(0);
  });

  it("borne l’historique et les commandes persistées", async () => {
    const root = await tempRoot(); const engine = new VideoQueueEngine({ root, adapter: new FakeWorkflowAdapter(), autoProcess: false }); await add(engine);
    const seeded = await loadVideoQueueStore(root); const itemId = seeded.items[0].itemId;
    seeded.history = Array.from({ length: 499 }, (_, index) => ({ eventId: `${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`, itemId, at: "2026-07-28T12:00:00.000Z", from: "paused" as const, to: "queued" as const, reasonCode: "FIXTURE" }));
    seeded.commands = Array.from({ length: 199 }, (_, index) => ({ idempotencyKey: `fixture:${index.toString().padStart(4, "0")}`, command: "pause" as const, requestHash: "a".repeat(64), completedAt: "2026-07-28T12:00:00.000Z", result: {} }));
    await saveVideoQueueStore(seeded, root);
    await engine.pause({ idempotencyKey: "command:pause:bound" });
    await engine.resume({ idempotencyKey: "command:resume:bound" });
    const store = await loadVideoQueueStore(root);
    expect(store.history).toHaveLength(500); expect(store.commands).toHaveLength(200);
  });

  it("ne modifie aucun vault factice, ne crée aucune session Apply et ne fuit ni chemin ni clé", async () => {
    const root = await tempRoot(); const vault = await tempRoot("tk-phase11a-vault-"); const sessions = path.join(root, "apply-sessions");
    await mkdir(path.join(vault, "02_SOURCES"), { recursive: true }); const videos = path.join(vault, "02_SOURCES", "videos.md"); await writeFile(videos, `# Vidéos\n\n| Titre | URL |\n|---|---|\n| Déjà vue | ${firstUrl} |\n`, "utf8");
    const before = hash(await readFile(videos)); const adapter = new FakeWorkflowAdapter(); adapter.duplicates.set(firstUrl, [{ kind: "library", title: "Déjà vue", imported: true }]);
    const engine = new VideoQueueEngine({ root: path.join(root, "queue"), adapter, autoProcess: false }); const result = await add(engine, [firstUrl], "secret-command-key");
    expect(result.results[0].status).toBe("duplicate"); expect(hash(await readFile(videos))).toBe(before);
    await expect(readFile(path.join(sessions, "session.json"))).rejects.toMatchObject({ code: "ENOENT" });
    const serialized = JSON.stringify(await engine.snapshot()); expect(serialized).not.toContain(root); expect(serialized).not.toContain("secret-command-key");
  });

  it("ferme le contrat API aux champs inconnus, origines externes et erreurs brutes", () => {
    expect(() => addVideosCommandSchema.parse({ idempotencyKey: "command:strict:1", urls: [firstUrl], localPath: "C:\\private" })).toThrow();
    const request = new NextRequest("http://localhost/api/video-queue", { method: "POST", headers: { host: "localhost", origin: "https://evil.example" } });
    expect(() => assertSameOrigin(request)).toThrow();
    expect(publicVideoQueueError(new Error("C:\\private\\token-secret"))).toEqual({ code: "QUEUE_OPERATION_FAILED", message: "La commande de file n’a pas pu être exécutée." });
  });
});
