import { Suspense } from "react";

import { ChatGptPackageWizard } from "@/components/chatgpt-package-wizard";
import { listAnalysisProviderAvailability } from "@/lib/analysis-providers/registry";
import { LibraryShell } from "@/components/library-shell";
import { inspectLibrary } from "@/lib/library/library-reader";
import { getAcquisitionManager } from "@/lib/transcription/manager";

export const dynamic = "force-dynamic";

export default async function NewChatGptPackagePage() {
  const [library, jobs] = await Promise.all([inspectLibrary(), getAcquisitionManager().list()]);
  if (!library.available) throw new Error(library.message);
  const acquisitions = jobs.filter((job) => job.status === "completed" && job.artifacts.some((artifact) => artifact.name === "transcript.txt"));
  const providers = listAnalysisProviderAvailability();
  return <LibraryShell tree={library.tree}><main className="mx-auto max-w-5xl"><p className="text-xs font-semibold tracking-[0.16em] text-violet-600 uppercase">Analyse contrôlée</p><h1 className="mt-2 text-3xl font-bold">Préparer l’analyse</h1><p className="mt-3 text-slate-600 dark:text-slate-400">Le parcours recommandé crée un paquet manuel, sans réseau ni clé. Vous choisissez les documents utiles avant sa création.</p><details className="my-6 rounded-2xl border border-violet-200 bg-violet-50 p-5 dark:border-violet-900 dark:bg-violet-950/20"><summary className="cursor-pointer font-bold">Options d’analyse avancées</summary><div className="mt-4 grid gap-3 sm:grid-cols-3">{providers.map((provider) => <article key={provider.id} className="rounded-xl bg-white p-4 dark:bg-slate-900"><strong>{provider.label}</strong><p className="mt-1 text-xs text-slate-500">{provider.configured ? provider.automatic ? "Disponible uniquement sur action explicite" : "Parcours manuel actif" : provider.reason}</p></article>)}</div><p className="mt-3 text-xs text-slate-500">Ouvrir cette page ne lance aucun appel distant. Le fournisseur OpenAI reste désactivé sans quatre activations locales et une confirmation par requête.</p></details>{acquisitions.length ? <Suspense fallback={<p>Chargement de l’assistant…</p>}><ChatGptPackageWizard acquisitions={acquisitions} /></Suspense> : <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">Aucune transcription prête. Revenez à « Ajouter une vidéo » pour commencer.</p>}</main></LibraryShell>;
}
