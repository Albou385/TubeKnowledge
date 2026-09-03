import { z } from "zod";

export const WORKFLOW_STATES = [
  "draft",
  "inspecting",
  "source-selection",
  "acquiring",
  "transcript-ready",
  "analysis-preparing",
  "analysis-ready",
  "awaiting-result",
  "result-received",
  "preview-ready",
  "blocked-reader",
  "blocked-conflict",
  "imported",
  "failed",
  "canceled",
] as const;

export const workflowStateSchema = z.enum(WORKFLOW_STATES);
export type WorkflowState = z.infer<typeof workflowStateSchema>;

const knowledgePathSchema = z.string().min(1).max(500).refine((value) => !value.includes("\\") && !value.startsWith("/") && !/^[a-z]:/i.test(value) && value.toLowerCase().endsWith(".md") && value.split("/").every((part) => part && part !== "." && part !== ".."), "Chemin de connaissance invalide.");

export const workflowSchema = z.object({
  schemaVersion: z.literal(1),
  workflowId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  state: workflowStateSchema,
  sourceUrl: z.string().url().refine((value) => new URL(value).protocol === "https:", "URL HTTPS requise."),
  videoId: z.string().regex(/^[A-Za-z0-9_-]{6,20}$/).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  acquisitionId: z.string().uuid().optional(),
  packageId: z.string().uuid().optional(),
  previewSessionId: z.string().uuid().optional(),
  importId: z.string().uuid().optional(),
  lastErrorCode: z.string().regex(/^[A-Z0-9_]+$/).max(80).optional(),
  nextAction: z.string().min(1).max(160),
  reprocessingApproved: z.boolean().default(false),
  knowledgePaths: z.array(knowledgePathSchema).max(100).default([]),
}).strict();

export type VideoKnowledgeWorkflow = z.infer<typeof workflowSchema>;

const ALLOWED_TRANSITIONS: Readonly<Record<WorkflowState, readonly WorkflowState[]>> = {
  draft: ["inspecting", "canceled", "failed"],
  inspecting: ["source-selection", "failed", "canceled"],
  "source-selection": ["acquiring", "failed", "canceled"],
  acquiring: ["transcript-ready", "failed", "canceled"],
  "transcript-ready": ["analysis-preparing", "failed", "canceled"],
  "analysis-preparing": ["analysis-ready", "failed", "canceled"],
  "analysis-ready": ["awaiting-result", "result-received", "failed", "canceled"],
  "awaiting-result": ["result-received", "failed", "canceled"],
  "result-received": ["preview-ready", "blocked-reader", "blocked-conflict", "failed"],
  "preview-ready": ["blocked-reader", "blocked-conflict", "imported", "failed"],
  "blocked-reader": ["preview-ready", "blocked-conflict", "imported", "failed"],
  "blocked-conflict": ["preview-ready", "blocked-reader", "failed"],
  imported: [],
  failed: ["inspecting", "source-selection", "acquiring", "analysis-preparing", "awaiting-result", "canceled"],
  canceled: [],
};

export function assertWorkflowTransition(from: WorkflowState, to: WorkflowState): void {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`Transition de workflow interdite : ${from} -> ${to}.`);
  }
}

export function nextActionForState(state: WorkflowState): string {
  const actions: Record<WorkflowState, string> = {
    draft: "Inspecter la vidéo",
    inspecting: "Attendre la fin de l’inspection",
    "source-selection": "Choisir la transcription",
    acquiring: "Suivre la transcription",
    "transcript-ready": "Préparer l’analyse",
    "analysis-preparing": "Préparer le contexte",
    "analysis-ready": "Télécharger le paquet d’analyse",
    "awaiting-result": "Recevoir le résultat",
    "result-received": "Prévisualiser les changements",
    "preview-ready": "Confirmer l’ajout à la bibliothèque",
    "blocked-reader": "Autoriser l’écriture sur cette machine puis reprendre",
    "blocked-conflict": "Résoudre le conflit puis reprendre",
    imported: "Ouvrir les connaissances",
    failed: "Examiner l’erreur et réessayer",
    canceled: "Créer un nouveau traitement",
  };
  return actions[state];
}
