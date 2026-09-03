import { PUBLIC_TRANSCRIPTION_ERRORS, isPublicTranscriptionErrorCode } from "./error-catalog";

export function clientErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== "object") return fallback;
  const code = (error as { code?: unknown }).code;
  return isPublicTranscriptionErrorCode(code) ? PUBLIC_TRANSCRIPTION_ERRORS[code] : fallback;
}

