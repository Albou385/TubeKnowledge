import { AppHeader } from "@/components/app-header";
import { AcquisitionWorkbench } from "@/components/acquisition-workbench";

export default function NewAcquisitionPage() {
  return <div className="min-h-screen bg-slate-50 dark:bg-slate-950"><AppHeader /><main className="mx-auto max-w-5xl px-5 py-10 sm:px-8"><p className="text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase dark:text-cyan-300">Phase 4</p><h1 className="mt-2 text-3xl font-bold">Nouvelle acquisition</h1><p className="mt-2 mb-8 text-slate-600 dark:text-slate-400">Inspectez avant tout téléchargement, ou normalisez un fichier UTF-8 local.</p><AcquisitionWorkbench /></main></div>;
}

