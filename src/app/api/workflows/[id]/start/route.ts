import { NextRequest, NextResponse } from "next/server";

import { assertSameOrigin } from "@/lib/imports/http";
import { startAcquisitionSchema } from "@/lib/transcription/schemas";
import { publicWorkflowError } from "@/lib/workflows/errors";
import { loadWorkflow, startWorkflowAcquisition } from "@/lib/workflows/orchestrator";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const id = (await params).id;
    const workflow = await loadWorkflow(id);
    const input = startAcquisitionSchema.parse({ jobId: workflow.acquisitionId, source: (await request.json()).source });
    return NextResponse.json({ workflow: await startWorkflowAcquisition(id, input.source) }, { status: 202 });
  } catch (error) { return NextResponse.json({ error: publicWorkflowError(error, "ACQUISITION_FAILED") }, { status: 400 }); }
}
