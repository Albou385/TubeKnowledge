import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { WorkflowDetail } from "@/components/workflow-detail";
import { getAcquisitionManager } from "@/lib/transcription/manager";
import { loadWorkflow } from "@/lib/workflows/orchestrator";

export const dynamic = "force-dynamic";

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  let workflow;
  try {
    workflow = await loadWorkflow((await params).id);
  } catch { notFound(); }
  const job = workflow.acquisitionId ? await getAcquisitionManager().get(workflow.acquisitionId).catch(() => null) : null;
  return <div className="min-h-screen bg-slate-50 dark:bg-slate-950"><AppHeader /><main className="mx-auto max-w-5xl px-5 py-10 sm:px-8"><WorkflowDetail initialWorkflow={workflow} initialJob={job} /></main></div>;
}
