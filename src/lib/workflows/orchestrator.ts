import type { LibraryEnvironment } from "@/lib/config/library-config";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { readImportHistory } from "@/lib/imports/history";
import { readMarkdownDocument } from "@/lib/library/library-reader";
import { getPortabilityStatus } from "@/lib/portability/status";
import { getAcquisitionManager, type AcquisitionManager } from "@/lib/transcription/manager";
import type { AcquisitionJob } from "@/lib/transcription/types";
import { validateYoutubeUrl } from "@/lib/transcription/youtube-url";

import { WorkflowError } from "./errors";
import { createWorkflowRecord, deleteWorkflowRecord, listWorkflows, loadWorkflow, transitionWorkflow, updateWorkflow, workflowsRuntimePath } from "./runtime";
import type { VideoKnowledgeWorkflow, WorkflowState } from "./schema";

export interface WorkflowDuplicate {
  kind: "workflow" | "acquisition" | "library";
  title: string;
  workflowId?: string;
  acquisitionId?: string;
  imported: boolean;
}

export interface WorkflowOrchestratorOptions {
  environment?: LibraryEnvironment;
  processEnvironment?: NodeJS.ProcessEnv;
  root?: string;
  manager?: Pick<AcquisitionManager, "inspect" | "start" | "resume" | "get" | "list"> & Partial<Pick<AcquisitionManager, "cancel">>;
  now?: () => Date;
  workflowId?: string;
}

function optionsWithDefaults(options: WorkflowOrchestratorOptions) {
  const processEnvironment = options.processEnvironment ?? process.env;
  return {
    environment: options.environment ?? processEnvironment,
    root: options.root ?? workflowsRuntimePath(processEnvironment),
    manager: options.manager ?? getAcquisitionManager(),
    now: options.now ?? (() => new Date()),
  };
}

export async function detectWorkflowDuplicates(sourceUrl: string, options: WorkflowOrchestratorOptions = {}): Promise<WorkflowDuplicate[]> {
  const context = optionsWithDefaults(options);
  const validated = validateYoutubeUrl(sourceUrl);
  const [workflows, acquisitions] = await Promise.all([listWorkflows(context.root), context.manager.list()]);
  const duplicates: WorkflowDuplicate[] = [];
  for (const workflow of workflows) {
    if (workflow.sourceUrl === validated.canonicalUrl || workflow.videoId === validated.videoId) {
      duplicates.push({ kind: "workflow", title: workflow.title ?? "Traitement existant", workflowId: workflow.workflowId, imported: workflow.state === "imported" });
    }
  }
  for (const acquisition of acquisitions) {
    if (acquisition.source?.canonicalUrl === validated.canonicalUrl || acquisition.source?.videoId === validated.videoId) {
      if (!duplicates.some((item) => item.acquisitionId === acquisition.id)) duplicates.push({ kind: "acquisition", title: acquisition.title ?? "Acquisition existante", acquisitionId: acquisition.id, imported: false });
    }
  }
  try {
    const videos = await readMarkdownDocument("02_SOURCES/videos.md", context.environment);
    if (videos.content.includes(validated.canonicalUrl) || videos.content.includes(validated.videoId)) {
      duplicates.push({ kind: "library", title: "Entrée existante dans la liste des vidéos", imported: true });
    }
  } catch { /* Une liste absente n’empêche pas le parcours; la génération Phase 5 la validera. */ }
  return duplicates;
}

export async function createVideoKnowledgeWorkflow(input: { sourceUrl: string; allowReprocess?: boolean }, options: WorkflowOrchestratorOptions = {}): Promise<{ workflow: VideoKnowledgeWorkflow; duplicates: WorkflowDuplicate[] }> {
  const context = optionsWithDefaults(options);
  let validated;
  try { validated = validateYoutubeUrl(input.sourceUrl); }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new WorkflowError(message.includes("Seules les URL HTTPS YouTube") ? "NOT_YOUTUBE_URL" : "UNRECOGNIZED_YOUTUBE_URL", { cause: error });
  }
  const duplicates = await detectWorkflowDuplicates(validated.canonicalUrl, options);
  if (duplicates.length && !input.allowReprocess) throw new WorkflowError("DUPLICATE_REQUIRES_CONFIRMATION");
  const workflow = await createWorkflowRecord({ sourceUrl: validated.canonicalUrl, videoId: validated.videoId, reprocessingApproved: Boolean(input.allowReprocess) }, { root: context.root, now: context.now(), workflowId: options.workflowId });
  return { workflow, duplicates };
}

export async function inspectVideoKnowledgeWorkflow(id: string, options: WorkflowOrchestratorOptions = {}): Promise<VideoKnowledgeWorkflow> {
  const context = optionsWithDefaults(options);
  const workflow = await loadWorkflow(id, context.root);
  if (!["draft", "inspecting", "failed"].includes(workflow.state)) throw new WorkflowError("WORKFLOW_CONFLICT");
  await transitionWorkflow(id, "inspecting", { lastErrorCode: undefined }, { root: context.root, now: context.now() });
  try {
    const acquisition = await context.manager.inspect(workflow.sourceUrl);
    return transitionWorkflow(id, "source-selection", {
      acquisitionId: acquisition.id,
      videoId: acquisition.inspection?.videoId ?? workflow.videoId,
      title: acquisition.title,
      lastErrorCode: undefined,
    }, { root: context.root, now: context.now() });
  } catch (error) {
    await transitionWorkflow(id, "failed", { lastErrorCode: "INSPECTION_FAILED" }, { root: context.root, now: context.now() });
    throw new WorkflowError("INSPECTION_FAILED", { cause: error });
  }
}

export async function startWorkflowAcquisition(id: string, source: unknown, options: WorkflowOrchestratorOptions = {}): Promise<VideoKnowledgeWorkflow> {
  const context = optionsWithDefaults(options);
  const workflow = await loadWorkflow(id, context.root);
  if (workflow.state !== "source-selection" || !workflow.acquisitionId) throw new WorkflowError("WORKFLOW_CONFLICT");
  try {
    const job = await context.manager.start({ jobId: workflow.acquisitionId, source });
    return transitionWorkflow(id, "acquiring", { title: job.title ?? workflow.title, lastErrorCode: undefined }, { root: context.root, now: context.now() });
  } catch (error) {
    await transitionWorkflow(id, "failed", { lastErrorCode: "ACQUISITION_FAILED" }, { root: context.root, now: context.now() });
    throw new WorkflowError("ACQUISITION_FAILED", { cause: error });
  }
}

function stateFromAcquisition(job: AcquisitionJob): WorkflowState | null {
  if (job.status === "waiting-for-selection") return "source-selection";
  if (job.status === "completed") return "transcript-ready";
  if (job.status === "failed" || job.status === "interrupted") return "failed";
  if (job.status === "canceled") return "canceled";
  return "acquiring";
}

export async function synchronizeWorkflow(id: string, options: WorkflowOrchestratorOptions = {}): Promise<VideoKnowledgeWorkflow> {
  const context = optionsWithDefaults(options);
  const workflow = await loadWorkflow(id, context.root);
  if (!workflow.acquisitionId || !["source-selection", "acquiring", "failed"].includes(workflow.state)) return workflow;
  const job = await context.manager.get(workflow.acquisitionId);
  const state = stateFromAcquisition(job);
  if (!state || state === workflow.state) return workflow;
  return transitionWorkflow(id, state, { title: job.title ?? workflow.title, lastErrorCode: job.error?.code }, { root: context.root, now: context.now() });
}

export async function attachPackageToWorkflow(id: string, packageId: string, options: WorkflowOrchestratorOptions = {}): Promise<VideoKnowledgeWorkflow> {
  const context = optionsWithDefaults(options);
  const workflow = await loadWorkflow(id, context.root);
  if (workflow.state === "transcript-ready") await transitionWorkflow(id, "analysis-preparing", {}, { root: context.root, now: context.now() });
  const current = await loadWorkflow(id, context.root);
  if (current.state !== "analysis-preparing" && current.state !== "analysis-ready") throw new WorkflowError("WORKFLOW_CONFLICT");
  return transitionWorkflow(id, "analysis-ready", { packageId }, { root: context.root, now: context.now() });
}

export async function markWorkflowAwaitingResult(id: string, options: WorkflowOrchestratorOptions = {}): Promise<VideoKnowledgeWorkflow> {
  const context = optionsWithDefaults(options);
  return transitionWorkflow(id, "awaiting-result", {}, { root: context.root, now: context.now() });
}

export async function attachPreviewToWorkflow(id: string, input: { previewSessionId: string; canApply: boolean }, options: WorkflowOrchestratorOptions = {}): Promise<VideoKnowledgeWorkflow> {
  const context = optionsWithDefaults(options);
  let workflow = await loadWorkflow(id, context.root);
  if (["analysis-ready", "awaiting-result"].includes(workflow.state)) workflow = await transitionWorkflow(id, "result-received", {}, { root: context.root, now: context.now() });
  if (workflow.state !== "result-received" && !["preview-ready", "blocked-reader", "blocked-conflict"].includes(workflow.state)) throw new WorkflowError("WORKFLOW_CONFLICT");
  if (!input.canApply) return transitionWorkflow(id, "blocked-conflict", { previewSessionId: input.previewSessionId }, { root: context.root, now: context.now() });
  const status = await getPortabilityStatus(context.environment, context.now());
  const canWrite = !status.enabled || status.writer.canWrite;
  const nextState = canWrite ? "preview-ready" : "blocked-reader";
  if (workflow.state === nextState) return updateWorkflow(id, { previewSessionId: input.previewSessionId }, { root: context.root, now: context.now() });
  return transitionWorkflow(id, nextState, { previewSessionId: input.previewSessionId }, { root: context.root, now: context.now() });
}

export async function markWorkflowImported(id: string, input: { importId: string }, options: WorkflowOrchestratorOptions = {}): Promise<VideoKnowledgeWorkflow> {
  const context = optionsWithDefaults(options);
  const workflow = await loadWorkflow(id, context.root);
  if (workflow.state === "imported" && workflow.importId === input.importId) return workflow;
  const config = parseLibraryConfig(context.environment);
  if (!config.ok) throw new WorkflowError("WORKFLOW_CONFLICT");
  const imported = (await readImportHistory(config.rootPath)).find((entry) => entry.importId === input.importId && entry.status === "success");
  if (!imported || (workflow.packageId && imported.packageId !== workflow.packageId)) throw new WorkflowError("WORKFLOW_CONFLICT");
  const knowledgePaths = [...new Set([...imported.filesCreated, ...imported.filesReplaced])];
  return transitionWorkflow(id, "imported", { importId: input.importId, knowledgePaths }, { root: context.root, now: context.now() });
}

export async function resumeWorkflowAcquisition(id: string, options: WorkflowOrchestratorOptions = {}): Promise<VideoKnowledgeWorkflow> {
  const context = optionsWithDefaults(options);
  const workflow = await loadWorkflow(id, context.root);
  if (workflow.state !== "failed" || !workflow.acquisitionId) throw new WorkflowError("WORKFLOW_CONFLICT");
  const current = await context.manager.get(workflow.acquisitionId);
  if (current.status === "waiting-for-selection") {
    return transitionWorkflow(id, "source-selection", { lastErrorCode: undefined }, { root: context.root, now: context.now() });
  }
  try {
    const job = await context.manager.resume(workflow.acquisitionId);
    return transitionWorkflow(id, "acquiring", { title: job.title ?? workflow.title, lastErrorCode: undefined }, { root: context.root, now: context.now() });
  } catch (error) {
    const currentJob = await context.manager.get(workflow.acquisitionId).catch(() => null);
    await updateWorkflow(id, { lastErrorCode: currentJob?.error?.code ?? "ACQUISITION_FAILED" }, { root: context.root, now: context.now() });
    throw new WorkflowError("ACQUISITION_FAILED", { cause: error });
  }
}

export async function cancelVideoKnowledgeWorkflow(id: string, options: WorkflowOrchestratorOptions = {}): Promise<VideoKnowledgeWorkflow> {
  const context = optionsWithDefaults(options);
  const workflow = await loadWorkflow(id, context.root);
  if (workflow.state === "canceled") return workflow;
  if (workflow.state === "imported") throw new WorkflowError("WORKFLOW_CONFLICT");
  if (workflow.acquisitionId) {
    const acquisition = await context.manager.get(workflow.acquisitionId).catch(() => null);
    if (acquisition && !["completed", "failed", "canceled", "interrupted"].includes(acquisition.status)) {
      if (!context.manager.cancel) throw new WorkflowError("WORKFLOW_CONFLICT");
      await context.manager.cancel(workflow.acquisitionId);
    }
  }
  return transitionWorkflow(id, "canceled", {}, { root: context.root, now: context.now() });
}

export async function findWorkflowByPackageId(packageId: string, options: WorkflowOrchestratorOptions = {}): Promise<VideoKnowledgeWorkflow | null> {
  const context = optionsWithDefaults(options);
  return (await listWorkflows(context.root)).find((workflow) => workflow.packageId === packageId) ?? null;
}

export async function removeVideoKnowledgeWorkflow(id: string, confirmed: boolean, options: WorkflowOrchestratorOptions = {}): Promise<void> {
  const context = optionsWithDefaults(options);
  await deleteWorkflowRecord(id, confirmed, context.root);
}

export { listWorkflows, loadWorkflow, updateWorkflow };
