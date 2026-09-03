export const PUBLIC_WORKFLOW_ERRORS = {
  INVALID_REQUEST: "La demande de traitement est invalide.",
  NOT_YOUTUBE_URL: "Entrez une URL YouTube valide.",
  UNRECOGNIZED_YOUTUBE_URL: "Cette URL YouTube ne peut pas être reconnue. Vérifiez-la puis réessayez.",
  WORKFLOW_NOT_FOUND: "Le traitement demandé est introuvable.",
  DUPLICATE_REQUIRES_CONFIRMATION: "Cette vidéo est déjà présente ou en cours de traitement. Confirmez explicitement le retraitement.",
  INSPECTION_FAILED: "L’inspection de la vidéo a échoué.",
  ACQUISITION_FAILED: "La transcription n’a pas pu démarrer.",
  WORKFLOW_CONFLICT: "Le traitement ne peut pas avancer depuis son état actuel.",
  WORKFLOW_FAILED: "Le traitement n’a pas pu être mis à jour.",
} as const;

export type PublicWorkflowErrorCode = keyof typeof PUBLIC_WORKFLOW_ERRORS;

export class WorkflowError extends Error {
  constructor(readonly code: PublicWorkflowErrorCode, options?: { cause?: unknown }) {
    super(PUBLIC_WORKFLOW_ERRORS[code], options);
    this.name = "WorkflowError";
  }
}

export function publicWorkflowError(error: unknown, fallback: PublicWorkflowErrorCode = "WORKFLOW_FAILED") {
  const code = error instanceof WorkflowError ? error.code : fallback;
  return { code, message: PUBLIC_WORKFLOW_ERRORS[code] };
}
