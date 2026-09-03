import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { STATE_LABELS } from "@/components/workflow-starter";
import { listWorkflows } from "@/lib/workflows/orchestrator";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  const workflows = await listWorkflows();
  return <div className="min-h-screen bg-slate-50 dark:bg-slate-950"><AppHeader /><main className="mx-auto max-w-6xl px-5 py-10 sm:px-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase dark:text-cyan-300">Reprise locale</p><h1 className="mt-2 text-3xl font-bold">Traitements récents</h1><p className="mt-2 text-slate-500">Chaque traitement conserve seulement les liens vers ses acquisitions, paquets et imports.</p></div><div className="flex flex-wrap gap-3"><Link href="/video-queue" className="rounded-xl border border-cyan-300 px-5 py-3 font-semibold text-cyan-800 dark:border-cyan-800 dark:text-cyan-200">Ouvrir la file</Link><Link href="/add-video" className="rounded-xl bg-cyan-400 px-5 py-3 font-bold text-slate-950">Ajouter une vidéo</Link></div></div><div className="mt-8 grid gap-3">{workflows.length ? workflows.map((workflow) => <Link key={workflow.workflowId} href={`/workflows/${workflow.workflowId}`} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 hover:border-cyan-400 dark:border-slate-800 dark:bg-slate-900"><div><strong>{workflow.title ?? "Vidéo à inspecter"}</strong><p className="mt-1 text-sm text-slate-500">{workflow.nextAction} · {new Date(workflow.updatedAt).toLocaleString("fr-CA")}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold dark:bg-slate-800">{STATE_LABELS[workflow.state]}</span></Link>) : <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">Aucun traitement récent.</p>}</div></main></div>;
}
