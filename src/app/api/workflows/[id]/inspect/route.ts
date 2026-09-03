import { NextRequest, NextResponse } from "next/server";

import { assertSameOrigin } from "@/lib/imports/http";
import { publicWorkflowError } from "@/lib/workflows/errors";
import { inspectVideoKnowledgeWorkflow } from "@/lib/workflows/orchestrator";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    return NextResponse.json({ workflow: await inspectVideoKnowledgeWorkflow((await params).id) });
  } catch (error) { return NextResponse.json({ error: publicWorkflowError(error, "INSPECTION_FAILED") }, { status: 400 }); }
}
