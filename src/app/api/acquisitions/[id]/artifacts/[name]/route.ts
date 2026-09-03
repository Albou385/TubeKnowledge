import { readFile } from "node:fs/promises";

import { NextRequest, NextResponse } from "next/server";

import { getRuntimeLocation } from "@/lib/transcription/runtime-location";
import { resolveArtifact } from "@/lib/transcription/runtime";
import { transcriptionApiError } from "@/lib/transcription/api-errors";

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, context: { params: Promise<{ id: string; name: string }> }) {
  try {
    const { id, name } = await context.params;
    const artifact = await resolveArtifact(getRuntimeLocation(), id, name);
    const bytes = await readFile(artifact.path);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "content-type": artifact.contentType,
        "content-length": String(artifact.size),
        "content-disposition": `attachment; filename="${name.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return transcriptionApiError(error, "ARTIFACT_NOT_FOUND", 404);
  }
}
