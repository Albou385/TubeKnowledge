import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { getAcquisitionManager } from "@/lib/transcription/manager";

export const dynamic = "force-dynamic";

export default async function AcquisitionsPage() {
  const jobs = await getAcquisitionManager().list();
  return <div className="min-h-screen bg-slate-50 dark:bg-slate-950"><AppHeader /><main className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase dark:text-cyan-300">Phase 4</p><h1 className="mt-2 text-3xl font-bold">Acquisitions</h1><p className="mt-2 text-slate-600 dark:text-slate-400">Transcriptions locales conservées hors du vault.</p></div><Link href="/acquisitions/new" className="rounded-xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950">Nouvelle acquisition</Link></div>
    <div className="mt-8 space-y-3">{jobs.length ? jobs.map((job) => <Link key={job.id} href={`/acquisitions/${job.id}`} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 hover:border-cyan-400 dark:border-slate-800 dark:bg-slate-900"><div><strong>{job.title || "Acquisition sans titre"}</strong><p className="mt-1 text-sm text-slate-500">{job.sourceKind || job.source?.type} · {new Date(job.createdAt).toLocaleString("fr-CA")}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold dark:bg-slate-800">{job.status}</span></Link>) : <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">Aucune acquisition. Inspectez une URL YouTube ou importez une transcription locale.</div>}</div>
  </main></div>;
}

