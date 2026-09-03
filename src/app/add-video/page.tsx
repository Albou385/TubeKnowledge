import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { WorkflowStarter } from "@/components/workflow-starter";
import { listWorkflows } from "@/lib/workflows/orchestrator";

export const dynamic = "force-dynamic";

export default async function AddVideoPage() {
  const recent = (await listWorkflows()).slice(0, 5);
  return <div className="min-h-screen bg-slate-50 dark:bg-slate-950"><AppHeader /><main className="mx-auto max-w-5xl px-5 py-10 sm:px-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase dark:text-cyan-300">Parcours principal</p><h1 className="mt-2 text-4xl font-bold tracking-tight">Ajouter une vidéo</h1><p className="mt-3 max-w-2xl text-slate-600 dark:text-slate-400">De la transcription à la connaissance, avec une vérification humaine avant toute écriture.</p></div><Link href="/video-queue" className="rounded-xl border border-cyan-300 px-5 py-3 font-semibold text-cyan-800 dark:border-cyan-800 dark:text-cyan-200">Ajouter plusieurs vidéos</Link></div><div className="mt-8"><WorkflowStarter recent={recent} /></div></main></div>;
}
