import { notFound } from "next/navigation";

import { AcquisitionDetail } from "@/components/acquisition-detail";
import { AppHeader } from "@/components/app-header";
import { getAcquisitionManager } from "@/lib/transcription/manager";

export const dynamic = "force-dynamic";

export default async function AcquisitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await loadJobOrNotFound(id);
  return <div className="min-h-screen bg-slate-50 dark:bg-slate-950"><AppHeader /><main className="mx-auto max-w-5xl px-5 py-10 sm:px-8"><AcquisitionDetail initialJob={job} /></main></div>;
}

async function loadJobOrNotFound(id: string) {
  try {
    return await getAcquisitionManager().get(id);
  } catch { notFound(); }
}
