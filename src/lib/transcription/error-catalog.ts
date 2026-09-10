export const PUBLIC_TRANSCRIPTION_ERRORS = {
  PYTHON_RUNTIME_UNAVAILABLE: "Le worker Python n’est pas disponible. Exécutez le script de configuration de la transcription.",
  FFMPEG_UNAVAILABLE: "FFmpeg n’est pas disponible. Installez-le ou configurez son chemin dans l’environnement local.",
  FFPROBE_UNAVAILABLE: "ffprobe n’est pas disponible. Installez-le ou configurez son chemin dans l’environnement local.",
  YT_DLP_UNAVAILABLE: "yt-dlp n’est pas disponible dans l’environnement Python de transcription.",
  FASTER_WHISPER_UNAVAILABLE: "faster-whisper n’est pas disponible dans l’environnement Python de transcription.",
  WORKER_DEPENDENCY_UNAVAILABLE: "Une dépendance du worker de transcription n’est pas disponible.",
  WORKER_PROTOCOL_INVALID: "Le worker de transcription a retourné une réponse invalide.",
  WORKER_TIMEOUT: "Le worker de transcription a dépassé le délai autorisé.",
  WORKER_FAILED: "Le worker de transcription a échoué. Consultez les journaux côté serveur.",
  TRANSCRIPTION_RUNTIME_UNAVAILABLE: "Le runtime de transcription local n’est pas disponible. Vérifiez sa configuration puis réessayez.",
  PYTHON_RUNTIME_INVALID: "Le Python sélectionné ne peut pas exécuter le worker. Vérifiez le venv ou le chemin Python configuré.",
  SUBTITLE_DOWNLOAD_FAILED: "Le téléchargement de la piste de sous-titres a échoué. Réessayez la même piste; aucune bascule vers Whisper n’a été effectuée.",
  SUBTITLE_NOT_AVAILABLE: "La piste de sous-titres choisie n’est plus disponible. Actualisez l’inspection puis choisissez une piste existante.",
  YOUTUBE_ACCESS_FAILED: "La connexion sécurisée à YouTube a échoué ou YouTube a refusé la requête. Vérifiez le réseau local puis réessayez.",
  VIDEO_UNAVAILABLE: "Cette vidéo n’est plus disponible publiquement. Essayez une autre vidéo.",
  AUTH_REQUIRED: "YouTube demande une authentification pour cette vidéo. Aucun compte n’est utilisé par TubeKnowledge.",
  NETWORK_ERROR: "La connexion réseau à YouTube a échoué. Vérifiez le réseau puis réessayez.",
  TRANSCRIPT_UNAVAILABLE: "Aucun transcript exploitable n’est disponible pour cette vidéo.",
  YOUTUBE_RATE_LIMITED: "YouTube limite temporairement les requêtes de sous-titres. Attendez quelques minutes, puis reprenez le même traitement.",
  TRANSCRIPT_NORMALIZATION_FAILED: "Les sous-titres reçus ne peuvent pas être transformés en transcript lisible. Essayez l’autre format de la même piste.",
  TRANSCRIPTION_TIMEOUT: "Le traitement a dépassé le délai autorisé. Reprenez le traitement depuis l’étape conservée.",
  TRANSCRIPTION_STORAGE_FAILED: "Le runtime local ne peut pas lire ou écrire les fichiers requis. Vérifiez l’espace disque et les permissions.",
  TRANSCRIPTION_INTERRUPTED: "Le traitement a été interrompu par un arrêt ou un redémarrage. Reprenez le même traitement.",
  INVALID_REQUEST: "La requête de transcription est invalide.",
  INVALID_URL: "Entrez une URL YouTube valide.",
  INSPECTION_FAILED: "L’inspection de la vidéo a échoué.",
  ACQUISITION_FAILED: "Le démarrage de l’acquisition a échoué.",
  TRANSCRIPTION_FAILED: "La transcription locale a échoué. Si CUDA était sélectionné, réessayez avec le CPU.",
  SUBTITLES_FAILED: "Le traitement des sous-titres a échoué.",
  UPLOAD_FAILED: "L’import de la transcription a échoué.",
  CANCEL_FAILED: "L’annulation du traitement a échoué.",
  DELETE_FAILED: "La suppression de l’acquisition a échoué.",
  ACQUISITION_NOT_FOUND: "L’acquisition demandée est introuvable.",
  ARTIFACT_NOT_FOUND: "L’artifact demandé est introuvable.",
  LIST_FAILED: "La liste des acquisitions est indisponible.",
} as const;

export type PublicTranscriptionErrorCode = keyof typeof PUBLIC_TRANSCRIPTION_ERRORS;

export interface PublicTranscriptionErrorPayload {
  code: PublicTranscriptionErrorCode;
  message: string;
}

export function isPublicTranscriptionErrorCode(value: unknown): value is PublicTranscriptionErrorCode {
  return typeof value === "string" && Object.hasOwn(PUBLIC_TRANSCRIPTION_ERRORS, value);
}

export function publicErrorPayload(code: PublicTranscriptionErrorCode): PublicTranscriptionErrorPayload {
  return { code, message: PUBLIC_TRANSCRIPTION_ERRORS[code] };
}

