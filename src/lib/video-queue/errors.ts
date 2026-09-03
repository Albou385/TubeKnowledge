export const PUBLIC_VIDEO_QUEUE_ERRORS = {
  INVALID_REQUEST: "La commande de file est invalide.",
  QUEUE_STATE_CORRUPT: "La file locale est illisible. Le fichier a été préservé pour diagnostic.",
  QUEUE_LOCKED: "La file est occupée. Réessayez dans un instant.",
  QUEUE_ITEM_NOT_FOUND: "L’élément demandé est introuvable.",
  QUEUE_COMMAND_CONFLICT: "Cette clé de commande a déjà été utilisée pour une autre action.",
  QUEUE_INVALID_STATE: "Cette action n’est pas permise depuis l’état actuel.",
  QUEUE_OPERATION_FAILED: "La commande de file n’a pas pu être exécutée.",
} as const;

export type PublicVideoQueueErrorCode = keyof typeof PUBLIC_VIDEO_QUEUE_ERRORS;

export class VideoQueueError extends Error {
  constructor(readonly code: PublicVideoQueueErrorCode, options?: { cause?: unknown }) {
    super(PUBLIC_VIDEO_QUEUE_ERRORS[code], options);
    this.name = "VideoQueueError";
  }
}

export function publicVideoQueueError(error: unknown, fallback: PublicVideoQueueErrorCode = "QUEUE_OPERATION_FAILED") {
  const code = error instanceof VideoQueueError ? error.code : fallback;
  return { code, message: PUBLIC_VIDEO_QUEUE_ERRORS[code] };
}

