import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { assertSameOrigin } from "@/lib/imports/http";
import { getAcquisitionManager } from "@/lib/transcription/manager";
import { transcriptionApiError } from "@/lib/transcription/api-errors";

const deleteSchema = z.object({ confirmed: z.literal(true) }).strict();

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ job: await getAcquisitionManager().get(id) }, { status: 200 });
  } catch (error) {
    return transcriptionApiError(error, "ACQUISITION_NOT_FOUND", 404);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    deleteSchema.parse(await request.json());
    const { id } = await context.params;
    await getAcquisitionManager().remove(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return transcriptionApiError(error, "DELETE_FAILED", 400);
  }
}
