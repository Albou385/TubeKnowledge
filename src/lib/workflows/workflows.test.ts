import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AcquisitionJob } from "@/lib/transcription/types";
import { appendImportHistory } from "@/lib/imports/history";

import { createVideoKnowledgeWorkflow, markWorkflowImported, removeVideoKnowledgeWorkflow, resumeWorkflowAcquisition, synchronizeWorkflow } from "./orchestrator";
import { createWorkflowRecord, listWorkflows, loadWorkflow, transitionWorkflow } from "./runtime";
import { assertWorkflowTransition, nextActionForState } from "./schema";

const roots: string[] = [];
async function tempRoot() { const root = await mkdtemp(path.join(os.tmpdir(), "tk-workflows-")); roots.push(root); return root; }
afterEach(async () => { const { rm } = await import("node:fs/promises"); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function job(overrides: Partial<AcquisitionJob> = {}): AcquisitionJob {
  return {
    schemaVersion: 1,
    id: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-07-27T04:00:00.000Z",
    updatedAt: "2026-07-27T04:00:00.000Z",
    status: "completed",
    stage: "completed",
    progress: 1,
    message: "Terminé",
    title: "Vidéo fixture",
    source: { type: "youtube", canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ" },
    warnings: [],
    artifacts: [{ kind: "transcript", name: "transcript.txt" }],
    ...overrides,
  };
}

describe("workflow Vidéo vers Connaissance", () => {
  it("explique distinctement une URL externe et une URL YouTube méconnaissable", async () => {
    const root = await tempRoot();
    const manager = { inspect: async () => job(), start: async () => job(), resume: async () => job(), get: async () => job(), list: async () => [] };
    await expect(createVideoKnowledgeWorkflow({ sourceUrl: "https://example.com/not-youtube" }, { root, manager })).rejects.toMatchObject({ code: "NOT_YOUTUBE_URL", message: "Entrez une URL YouTube valide." });
    await expect(createVideoKnowledgeWorkflow({ sourceUrl: "https://youtube.com/watch" }, { root, manager })).rejects.toMatchObject({ code: "UNRECOGNIZED_YOUTUBE_URL", message: "Cette URL YouTube ne peut pas être reconnue. Vérifiez-la puis réessayez." });
  });
  it("valide les transitions autorisées et refuse les sauts", () => {
    expect(() => assertWorkflowTransition("draft", "inspecting")).not.toThrow();
    expect(() => assertWorkflowTransition("draft", "imported")).toThrow("interdite");
    expect(nextActionForState("blocked-reader")).toContain("Autoriser l’écriture");
  });

  it("persiste, recharge et liste un schéma strict", async () => {
    const root = await tempRoot();
    const workflow = await createWorkflowRecord({ sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ" }, { root, workflowId: "11111111-1111-4111-8111-111111111111", now: new Date("2026-07-27T04:00:00Z") });
    await transitionWorkflow(workflow.workflowId, "inspecting", {}, { root, now: new Date("2026-07-27T04:01:00Z") });
    expect((await loadWorkflow(workflow.workflowId, root)).state).toBe("inspecting");
    expect(await listWorkflows(root)).toHaveLength(1);
  });

  it("détecte un doublon et exige une décision explicite de retraitement", async () => {
    const root = await tempRoot();
    const manager = { inspect: async () => job(), start: async () => job(), resume: async () => job(), get: async () => job(), list: async () => [] };
    await createVideoKnowledgeWorkflow({ sourceUrl: "https://youtu.be/dQw4w9WgXcQ" }, { root, manager });
    await expect(createVideoKnowledgeWorkflow({ sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, { root, manager })).rejects.toMatchObject({ code: "DUPLICATE_REQUIRES_CONFIRMATION" });
    await expect(createVideoKnowledgeWorkflow({ sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", allowReprocess: true }, { root, manager })).resolves.toMatchObject({ workflow: { reprocessingApproved: true } });
  });

  it("synchronise une acquisition terminée sans recopier le transcript", async () => {
    const root = await tempRoot();
    const workflow = await createWorkflowRecord({ sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, { root });
    await transitionWorkflow(workflow.workflowId, "inspecting", {}, { root });
    await transitionWorkflow(workflow.workflowId, "source-selection", { acquisitionId: job().id }, { root });
    await transitionWorkflow(workflow.workflowId, "acquiring", {}, { root });
    const manager = { inspect: async () => job(), start: async () => job(), resume: async () => job(), get: async () => job(), list: async () => [] };
    const synced = await synchronizeWorkflow(workflow.workflowId, { root, manager });
    expect(synced.state).toBe("transcript-ready");
    expect(JSON.stringify(synced)).not.toContain("transcript fixture");
  });

  it("reprend le même workflow et la même acquisition après un échec", async () => {
    const root = await tempRoot();
    const acquisition = job({ status: "failed", stage: "failed", progress: null, error: { code: "SUBTITLE_DOWNLOAD_FAILED", message: "fixture" } });
    const workflow = await createWorkflowRecord({ sourceUrl: acquisition.source!.canonicalUrl! }, { root });
    await transitionWorkflow(workflow.workflowId, "inspecting", {}, { root });
    await transitionWorkflow(workflow.workflowId, "source-selection", { acquisitionId: acquisition.id }, { root });
    await transitionWorkflow(workflow.workflowId, "acquiring", {}, { root });
    await transitionWorkflow(workflow.workflowId, "failed", { lastErrorCode: "SUBTITLE_DOWNLOAD_FAILED" }, { root });
    let resumes = 0;
    const manager = {
      inspect: async () => acquisition,
      start: async () => acquisition,
      resume: async (id: string) => { resumes += 1; expect(id).toBe(acquisition.id); return { ...acquisition, status: "queued" as const, error: undefined }; },
      get: async () => acquisition,
      list: async () => [],
    };
    const resumed = await resumeWorkflowAcquisition(workflow.workflowId, { root, manager });
    expect(resumed).toMatchObject({ workflowId: workflow.workflowId, acquisitionId: acquisition.id, state: "acquiring" });
    expect(resumes).toBe(1);
  });

  it("la lecture GET-equivalente ne réécrit pas le fichier", async () => {
    const root = await tempRoot();
    const workflow = await createWorkflowRecord({ sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, { root });
    const target = path.join(root, `${workflow.workflowId}.json`);
    const before = (await stat(target)).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await loadWorkflow(workflow.workflowId, root);
    expect((await stat(target)).mtimeMs).toBe(before);
  });

  it("supprime seulement le workflow et préserve les artifacts référencés", async () => {
    const root = await tempRoot();
    const artifact = path.join(root, "artifact.txt");
    await writeFile(artifact, "préserver", "utf8");
    const workflow = await createWorkflowRecord({ sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, { root });
    await expect(removeVideoKnowledgeWorkflow(workflow.workflowId, false, { root })).rejects.toThrow("Confirmation");
    await removeVideoKnowledgeWorkflow(workflow.workflowId, true, { root });
    await expect(loadWorkflow(workflow.workflowId, root)).rejects.toThrow();
    expect(await readFile(artifact, "utf8")).toBe("préserver");
  });

  it("n’accepte un succès que depuis l’historique Phase 3 et dérive les chemins", async () => {
    const root = await tempRoot();
    const workflowRoot = path.join(root, "workflows");
    const vault = path.join(root, "vault");
    await writeFile(path.join(root, "placeholder"), "fixture", "utf8");
    const workflow = await createWorkflowRecord({ sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, { root: workflowRoot });
    await transitionWorkflow(workflow.workflowId, "inspecting", {}, { root: workflowRoot });
    await transitionWorkflow(workflow.workflowId, "source-selection", { acquisitionId: job().id }, { root: workflowRoot });
    await transitionWorkflow(workflow.workflowId, "acquiring", {}, { root: workflowRoot });
    await transitionWorkflow(workflow.workflowId, "transcript-ready", {}, { root: workflowRoot });
    await transitionWorkflow(workflow.workflowId, "analysis-preparing", {}, { root: workflowRoot });
    const packageId = "33333333-3333-4333-8333-333333333333";
    await transitionWorkflow(workflow.workflowId, "analysis-ready", { packageId }, { root: workflowRoot });
    await transitionWorkflow(workflow.workflowId, "result-received", {}, { root: workflowRoot });
    await transitionWorkflow(workflow.workflowId, "preview-ready", { previewSessionId: "44444444-4444-4444-8444-444444444444" }, { root: workflowRoot });
    const importId = "55555555-5555-4555-8555-555555555555";
    await expect(markWorkflowImported(workflow.workflowId, { importId }, { root: workflowRoot, environment: { YOUTUBE_LIBRARY_PATH: vault } })).rejects.toMatchObject({ code: "WORKFLOW_CONFLICT" });
    await appendImportHistory(vault, { importId, packageId, timestamp: "2026-07-27T05:00:00.000Z", source: { type: "youtube-video", title: "Fixture", url: workflow.sourceUrl }, status: "success", structuralChange: { level: "none", confirmationRequired: false, summary: "Aucune" }, filesCreated: ["01_BIBLIOTHEQUE/IA/note.md"], filesReplaced: [], conflicts: [], backupId: "fixture-backup", durationMs: 1, message: "Succès" });
    await expect(markWorkflowImported(workflow.workflowId, { importId }, { root: workflowRoot, environment: { YOUTUBE_LIBRARY_PATH: vault } })).resolves.toMatchObject({ state: "imported", knowledgePaths: ["01_BIBLIOTHEQUE/IA/note.md"] });
  });
});
