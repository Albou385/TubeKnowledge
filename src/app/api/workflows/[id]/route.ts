import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { assertSameOrigin } from "@/lib/imports/http";
import { publicWorkflowError } from "@/lib/workflows/errors";
import {
  attachPackageToWorkflow,
  attachPreviewToWorkflow,
  loadWorkflow,
  markWorkflowAwaitingResult,
  markWorkflowImported,
  removeVideoKnowledgeWorkflow,
  resumeWorkflowAcquisition,
  synchronizeWorkflow,
} from "@/lib/workflows/orchestrator";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync") }).strict(),
  z.object({ action: z.literal("resume") }).strict(),
  z.object({ action: z.literal("attach-package"), packageId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("await-result") }).strict(),
  z.object({ action: z.literal("attach-preview"), previewSessionId: z.string().uuid(), canApply: z.boolean() }).strict(),
  z.object({ action: z.literal("imported"), importId: z.string().uuid() }).strict(),
]);

const deleteSchema = z.object({ confirmed: z.literal(true) }).strict();

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json({ workflow: await loadWorkflow((await params).id) }); }
  catch (error) { return NextResponse.json({ error: publicWorkflowError(error, "WORKFLOW_NOT_FOUND") }, { status: 404 }); }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const id = (await params).id;
    const input = actionSchema.parse(await request.json());
    const workflow = input.action === "sync" ? await synchronizeWorkflow(id)
      : input.action === "resume" ? await resumeWorkflowAcquisition(id)
      : input.action === "attach-package" ? await attachPackageToWorkflow(id, input.packageId)
      : input.action === "await-result" ? await markWorkflowAwaitingResult(id)
      : input.action === "attach-preview" ? await attachPreviewToWorkflow(id, input)
      : await markWorkflowImported(id, input);
    return NextResponse.json({ workflow });
  } catch (error) { return NextResponse.json({ error: publicWorkflowError(error) }, { status: 409 }); }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    deleteSchema.parse(await request.json());
    await removeVideoKnowledgeWorkflow((await params).id, true);
    return new NextResponse(null, { status: 204 });
  } catch (error) { return NextResponse.json({ error: publicWorkflowError(error) }, { status: 400 }); }
}
