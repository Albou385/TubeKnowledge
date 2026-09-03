import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { assertSameOrigin } from "@/lib/imports/http";
import { publicWorkflowError, WorkflowError } from "@/lib/workflows/errors";
import { createVideoKnowledgeWorkflow, listWorkflows } from "@/lib/workflows/orchestrator";

const createSchema = z.object({
  sourceUrl: z.string().trim().min(1).max(2_048),
  allowReprocess: z.boolean().default(false),
}).strict();

export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json({ workflows: await listWorkflows() }); }
  catch (error) { return NextResponse.json({ error: publicWorkflowError(error) }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const result = await createVideoKnowledgeWorkflow(createSchema.parse(await request.json()));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const status = error instanceof WorkflowError && error.code === "DUPLICATE_REQUIRES_CONFIRMATION" ? 409 : 400;
    return NextResponse.json({ error: publicWorkflowError(error, "INVALID_REQUEST") }, { status });
  }
}
