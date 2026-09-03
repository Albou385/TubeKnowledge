import { NextRequest, NextResponse } from "next/server";

import { assertSameOrigin } from "@/lib/imports/http";
import { getAcquisitionManager } from "@/lib/transcription/manager";
import { uploadMetadataSchema } from "@/lib/transcription/schemas";
import { MAX_TRANSCRIPT_UPLOAD_BYTES } from "@/lib/transcription/upload";
import { transcriptionApiError } from "@/lib/transcription/api-errors";
import { TranscriptionPublicError } from "@/lib/transcription/public-errors";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_TRANSCRIPT_UPLOAD_BYTES + 64 * 1024) throw new TranscriptionPublicError("INVALID_REQUEST", 413);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new TranscriptionPublicError("INVALID_REQUEST", 400);
    if (file.size > MAX_TRANSCRIPT_UPLOAD_BYTES) throw new TranscriptionPublicError("INVALID_REQUEST", 413);
    const metadata = uploadMetadataSchema.parse({ title: form.get("title"), url: form.get("url") || "" });
    const job = await getAcquisitionManager().upload(file.name, Buffer.from(await file.arrayBuffer()), metadata.title, metadata.url || undefined);
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return transcriptionApiError(error, "UPLOAD_FAILED", 400);
  }
}
