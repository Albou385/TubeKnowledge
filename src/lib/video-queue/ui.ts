import type { AddVideoResult, VideoQueueSnapshot } from "./engine";
import type { VideoQueueItem, VideoQueueItemState } from "./schema";

export const VIDEO_QUEUE_STATE_LABELS: Record<VideoQueueItemState, string> = {
  queued: "En attente",
  inspecting: "Inspection",
  transcribing: "Transcription",
  "transcript-ready": "Analyse",
  "analysis-required": "Analyse",
  "result-ready": "Vérification nécessaire",
  imported: "Terminé",
  paused: "En pause",
  cancelled: "Annulée",
  failed: "Échec",
};

export const VIDEO_QUEUE_STATE_TONES: Record<VideoQueueItemState, string> = {
  queued: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  inspecting: "bg-cyan-100 text-cyan-900 dark:bg-cyan-950 dark:text-cyan-100",
  transcribing: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  "transcript-ready": "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  "analysis-required": "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-100",
  "result-ready": "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100",
  imported: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  paused: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
  cancelled: "bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400",
  failed: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100",
};

export interface ParsedQueueInput {
  urls: string[];
  lineCount: number;
  validationMessage: string | null;
}

export function parseQueueInput(value: string): ParsedQueueInput {
  const urls = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const validationMessage = urls.length === 0
    ? "Ajoutez au moins une URL YouTube."
    : urls.length > 100
      ? "La soumission est limitée à 100 lignes à la fois."
      : urls.some((url) => url.length > 2_048)
        ? "Une URL dépasse la longueur maximale autorisée."
        : null;
  return { urls, lineCount: urls.length, validationMessage };
}

export type AddResultGroup = "accepted" | "submission" | "queue" | "workflow" | "library" | "invalid";

export const ADD_RESULT_TITLES: Record<AddResultGroup, string> = {
  accepted: "Vidéos ajoutées",
  submission: "Doublons dans la soumission",
  queue: "Déjà en cours",
  workflow: "Déjà en cours",
  library: "Vidéo déjà analysée",
  invalid: "URL invalide",
};

export function groupAddResults(results: AddVideoResult[]): Record<AddResultGroup, AddVideoResult[]> {
  const groups: Record<AddResultGroup, AddVideoResult[]> = { accepted: [], submission: [], queue: [], workflow: [], library: [], invalid: [] };
  for (const result of results) {
    if (result.status === "accepted") groups.accepted.push(result);
    else if (result.status === "rejected") groups.invalid.push(result);
    else {
      const kinds = new Set(result.duplicates?.map((duplicate) => duplicate.kind));
      if (kinds.has("submission")) groups.submission.push(result);
      else if (kinds.has("queue")) groups.queue.push(result);
      else if (kinds.has("library")) groups.library.push(result);
      else groups.workflow.push(result);
    }
  }
  return groups;
}

export function safeVideoLabel(videoId?: string): string {
  return videoId ? `youtube.com · ${videoId}` : "URL YouTube";
}

export function queueNextAction(item: VideoQueueItem): string {
  if (item.state === "paused" && item.pauseReason === "source-selection-required") return "Vérification nécessaire avant de poursuivre.";
  if (item.state === "paused") return "Le traitement reprendra lorsque vous le demanderez.";
  const actions: Record<Exclude<VideoQueueItemState, "paused">, string> = {
    queued: "En attente.",
    inspecting: "Inspection en cours.",
    transcribing: "Transcription en cours.",
    "transcript-ready": "Analyse en cours.",
    "analysis-required": "Analyse en cours.",
    "result-ready": "Vérification nécessaire.",
    imported: "Connaissances ajoutées à la bibliothèque.",
    cancelled: "Aucune action; ajoutez de nouveau l’URL si nécessaire.",
    failed: "Examiner l’échec puis réessayer explicitement.",
  };
  return actions[item.state];
}

export function workflowActionLabel(item: VideoQueueItem): string {
  if (item.state === "paused" || item.state === "result-ready") return "Vérifier";
  if (item.state === "imported") return "Voir le résultat";
  if (item.state === "failed") return "Voir le détail";
  return "Voir le détail";
}

export function publicQueueItemError(code?: string): string | null {
  if (!code) return null;
  const messages: Record<string, string> = {
    INSPECTION_FAILED: "L’inspection a échoué. Vérifiez la disponibilité de YouTube puis réessayez.",
    ACQUISITION_FAILED: "La transcription n’a pas pu démarrer. Ouvrez le traitement pour voir l’action proposée.",
    VIDEO_UNAVAILABLE: "Cette vidéo n’est pas disponible. Vérifiez l’URL ou son accès, puis réessayez si elle redevient disponible.",
    AUTH_REQUIRED: "YouTube demande une authentification. Utilisez une vidéo publiquement accessible ou vérifiez son accès.",
    NETWORK_ERROR: "La connexion à YouTube a échoué. Vérifiez le réseau puis réessayez.",
    YOUTUBE_ACCESS_FAILED: "YouTube a refusé ou limité l’accès à cette vidéo. Vérifiez sa disponibilité puis réessayez.",
    INVALID_URL: "L’URL YouTube est invalide. Corrigez-la avant de réessayer.",
    TRANSCRIPT_UNAVAILABLE: "Aucun transcript exploitable n’est disponible automatiquement pour cette vidéo.",
    AI_PROVIDER_CONFIGURATION_REQUIRED: "L’analyse automatique doit être configurée avant de pouvoir ajouter cette vidéo à la bibliothèque.",
    TRANSCRIPTION_INTERRUPTED: "La transcription a été interrompue. Utilisez Réessayer pour reprendre le même traitement.",
    YOUTUBE_RATE_LIMITED: "YouTube limite temporairement les requêtes. Attendez avant de réessayer.",
    QUEUE_INSPECTION_FAILED: "L’inspection a échoué. Réessayez lorsque la source est disponible.",
  };
  return messages[code] ?? "Le traitement a échoué. Ouvrez-le pour examiner la prochaine action, puis réessayez.";
}

export function shouldPollVideoQueue(queue: VideoQueueSnapshot): boolean {
  if (queue.paused) return queue.items.some((item) => item.state === "inspecting" || item.state === "transcribing");
  return Boolean(queue.activeItemId) || queue.items.some((item) => ["queued", "inspecting", "transcribing"].includes(item.state));
}

