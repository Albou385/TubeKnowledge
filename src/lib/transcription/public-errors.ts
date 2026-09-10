import { ZodError } from "zod";

import {
  PUBLIC_TRANSCRIPTION_ERRORS,
  isPublicTranscriptionErrorCode,
  publicErrorPayload,
  type PublicTranscriptionErrorCode,
  type PublicTranscriptionErrorPayload,
} from "./error-catalog";

export class TranscriptionPublicError extends Error {
  constructor(
    readonly code: PublicTranscriptionErrorCode,
    readonly status = 500,
    options?: { cause?: unknown },
  ) {
    super(PUBLIC_TRANSCRIPTION_ERRORS[code], options);
    this.name = "TranscriptionPublicError";
  }
}

export function normalizePublicError(
  error: unknown,
  fallbackCode: PublicTranscriptionErrorCode,
  fallbackStatus = 500,
): { payload: PublicTranscriptionErrorPayload; status: number } {
  if (error instanceof TranscriptionPublicError) return { payload: publicErrorPayload(error.code), status: error.status };
  if (error && typeof error === "object" && isPublicTranscriptionErrorCode((error as { code?: unknown }).code)) {
    const code = (error as { code: PublicTranscriptionErrorCode }).code;
    return { payload: publicErrorPayload(code), status: ["WORKER_TIMEOUT", "TRANSCRIPTION_TIMEOUT"].includes(code) ? 504 : 503 };
  }
  if (error instanceof ZodError) return { payload: publicErrorPayload("INVALID_REQUEST"), status: 400 };
  return { payload: publicErrorPayload(fallbackCode), status: fallbackStatus };
}

export function workerFailure(errorCode: string, technicalMessage?: string): TranscriptionPublicError {
  const mapping: Record<string, PublicTranscriptionErrorCode> = {
    FFMPEG_UNAVAILABLE: "FFMPEG_UNAVAILABLE",
    FFPROBE_UNAVAILABLE: "FFPROBE_UNAVAILABLE",
    YT_DLP_UNAVAILABLE: "YT_DLP_UNAVAILABLE",
    FASTER_WHISPER_UNAVAILABLE: "FASTER_WHISPER_UNAVAILABLE",
    TOOL_MISSING: "WORKER_DEPENDENCY_UNAVAILABLE",
    TOOL_TIMEOUT: "WORKER_TIMEOUT",
    TRANSCRIPTION_TIMEOUT: "TRANSCRIPTION_TIMEOUT",
    WORKER_PROTOCOL_INVALID: "WORKER_PROTOCOL_INVALID",
    TRANSCRIPTION_RUNTIME_UNAVAILABLE: "TRANSCRIPTION_RUNTIME_UNAVAILABLE",
    PYTHON_RUNTIME_INVALID: "PYTHON_RUNTIME_INVALID",
    SUBTITLE_DOWNLOAD_FAILED: "SUBTITLE_DOWNLOAD_FAILED",
    SUBTITLE_NOT_AVAILABLE: "SUBTITLE_NOT_AVAILABLE",
    YOUTUBE_ACCESS_FAILED: "YOUTUBE_ACCESS_FAILED",
    VIDEO_UNAVAILABLE: "VIDEO_UNAVAILABLE",
    AUTH_REQUIRED: "AUTH_REQUIRED",
    NETWORK_ERROR: "NETWORK_ERROR",
    TRANSCRIPT_UNAVAILABLE: "TRANSCRIPT_UNAVAILABLE",
    YOUTUBE_RATE_LIMITED: "YOUTUBE_RATE_LIMITED",
    TRANSCRIPT_NORMALIZATION_FAILED: "TRANSCRIPT_NORMALIZATION_FAILED",
    TRANSCRIPTION_STORAGE_FAILED: "TRANSCRIPTION_STORAGE_FAILED",
    TRANSCRIPTION_INTERRUPTED: "TRANSCRIPTION_INTERRUPTED",
    INVALID_URL: "INVALID_URL",
  };
  const code = mapping[errorCode] ?? (isPublicTranscriptionErrorCode(errorCode) ? errorCode : "WORKER_FAILED");
  return new TranscriptionPublicError(code, ["WORKER_TIMEOUT", "TRANSCRIPTION_TIMEOUT"].includes(code) ? 504 : 503, {
    cause: technicalMessage ? `worker:${errorCode}` : undefined,
  });
}

