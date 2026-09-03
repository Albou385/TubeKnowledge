import { NextResponse } from "next/server";

import type { PublicTranscriptionErrorCode } from "./error-catalog";
import { normalizePublicError } from "./public-errors";

export function transcriptionApiError(
  error: unknown,
  fallbackCode: PublicTranscriptionErrorCode,
  fallbackStatus = 500,
) {
  console.error("[TubeKnowledge transcription]", error);
  const normalized = normalizePublicError(error, fallbackCode, fallbackStatus);
  return NextResponse.json({ error: normalized.payload }, { status: normalized.status });
}

