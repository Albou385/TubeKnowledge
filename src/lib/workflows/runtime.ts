import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getRuntimeLocation } from "@/lib/transcription/runtime-location";

import { assertWorkflowTransition, nextActionForState, workflowSchema, type VideoKnowledgeWorkflow, type WorkflowState } from "./schema";

export function workflowsRuntimePath(environment: NodeJS.ProcessEnv = process.env): string {
  return path.join(getRuntimeLocation(environment).runtimePath, "video-knowledge-workflows");
}

export function assertWorkflowId(id: string): string {
  return workflowSchema.shape.workflowId.parse(id);
}

function workflowPath(root: string, id: string): string {
  return path.join(root, `${assertWorkflowId(id)}.json`);
}

async function atomicWriteJson(target: string, value: unknown): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, target);
}

export async function saveWorkflow(workflow: VideoKnowledgeWorkflow, root = workflowsRuntimePath()): Promise<VideoKnowledgeWorkflow> {
  const valid = workflowSchema.parse(workflow);
  await mkdir(root, { recursive: true });
  await atomicWriteJson(workflowPath(root, valid.workflowId), valid);
  return valid;
}

export async function createWorkflowRecord(input: { sourceUrl: string; videoId?: string; reprocessingApproved?: boolean }, options: { root?: string; now?: Date; workflowId?: string } = {}): Promise<VideoKnowledgeWorkflow> {
  const now = (options.now ?? new Date()).toISOString();
  return saveWorkflow(workflowSchema.parse({
    schemaVersion: 1,
    workflowId: options.workflowId ?? randomUUID(),
    createdAt: now,
    updatedAt: now,
    state: "draft",
    sourceUrl: input.sourceUrl,
    videoId: input.videoId,
    nextAction: nextActionForState("draft"),
    reprocessingApproved: input.reprocessingApproved ?? false,
    knowledgePaths: [],
  }), options.root);
}

export async function loadWorkflow(id: string, root = workflowsRuntimePath()): Promise<VideoKnowledgeWorkflow> {
  const target = workflowPath(root, id);
  const details = await lstat(target);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error("Workflow introuvable.");
  return workflowSchema.parse(JSON.parse(await readFile(target, "utf8")));
}

export async function listWorkflows(root = workflowsRuntimePath()): Promise<VideoKnowledgeWorkflow[]> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const workflows: VideoKnowledgeWorkflow[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) continue;
    try { workflows.push(await loadWorkflow(entry.name.slice(0, -5), root)); }
    catch { /* Une entrée corrompue n’est jamais exposée. */ }
  }
  return workflows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function updateWorkflow(id: string, changes: Partial<Omit<VideoKnowledgeWorkflow, "schemaVersion" | "workflowId" | "createdAt">>, options: { root?: string; now?: Date } = {}): Promise<VideoKnowledgeWorkflow> {
  const current = await loadWorkflow(id, options.root);
  const state = changes.state ?? current.state;
  assertWorkflowTransition(current.state, state);
  const updated = workflowSchema.parse({
    ...current,
    ...changes,
    state,
    nextAction: changes.nextAction ?? nextActionForState(state),
    updatedAt: (options.now ?? new Date()).toISOString(),
  });
  return saveWorkflow(updated, options.root);
}

export async function transitionWorkflow(id: string, state: WorkflowState, changes: Partial<Omit<VideoKnowledgeWorkflow, "schemaVersion" | "workflowId" | "createdAt" | "state">> = {}, options: { root?: string; now?: Date } = {}): Promise<VideoKnowledgeWorkflow> {
  return updateWorkflow(id, { ...changes, state }, options);
}

export async function deleteWorkflowRecord(id: string, confirmed: boolean, root = workflowsRuntimePath()): Promise<void> {
  if (!confirmed) throw new Error("Confirmation explicite requise.");
  await loadWorkflow(id, root);
  await rm(workflowPath(root, id), { force: false });
}
