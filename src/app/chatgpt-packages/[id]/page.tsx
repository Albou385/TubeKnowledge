import Link from "next/link";

import { ChatGptPackageActions } from "@/components/chatgpt-package-actions";
import { LibraryShell } from "@/components/library-shell";
import { SHORT_CHATGPT_INSTRUCTION } from "@/lib/chatgpt-packages/constants";
import { getChatGptProjectUrl } from "@/lib/chatgpt-packages/project-url";
import { loadStoredPackage } from "@/lib/chatgpt-packages/runtime";
import { inspectLibrary } from "@/lib/library/library-reader";

export const dynamic = "force-dynamic";

export default async function ChatGptPackagePage({ params }: { params: Promise<{ id: string }> }) {
  const [library, stored] = await Promise.all([inspectLibrary(), loadStoredPackage((await params).id)]);
  if (!library.available) throw new Error(library.message);
  const projectUrl = getChatGptProjectUrl();
  return <LibraryShell tree={library.tree}><main className="mx-auto max-w-5xl space-y-6"><Link href="/chatgpt-packages" className="text-sm text-violet-700 dark:text-violet-300">← Paquets d’analyse</Link><div><p className="text-xs font-semibold text-violet-600 uppercase">Analyse manuelle prête</p><h1 className="mt-2 text-3xl font-bold">{stored.manifest.source.title}</h1><p className="mt-3 text-slate-600 dark:text-slate-400">Suivez les trois étapes dans l’ordre. Le premier ZIP est une demande; le troisième bouton attend le ZIP de résultat retourné après l’analyse.</p></div><section className="rounded-2xl border border-violet-200 bg-violet-50 p-6 dark:border-violet-900 dark:bg-violet-950/20"><h2 className="text-xl font-bold">Analyse manuelle en trois étapes</h2><ol className="mt-3 list-decimal space-y-2 pl-5"><li>Télécharger le paquet à analyser.</li><li>Envoyer ce paquet à ChatGPT avec l’instruction copiée.</li><li>Importer ici le ZIP de résultat retourné.</li></ol><div className="mt-6"><ChatGptPackageActions packageId={stored.manifest.packageId} /></div></section>{projectUrl ? <a href={projectUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-violet-700 underline dark:text-violet-300">Ouvrir manuellement le projet ChatGPT ↗</a> : null}<section className="rounded-2xl border border-slate-200 p-6 dark:border-slate-800"><h2 className="text-xl font-bold">Instruction à transmettre</h2><pre className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-950 p-4 text-sm text-slate-100">{SHORT_CHATGPT_INSTRUCTION}</pre></section><details className="rounded-2xl border border-slate-200 p-6 dark:border-slate-800"><summary className="font-bold">Détails avancés du paquet</summary><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><span className="text-xs text-slate-500">Taille</span><strong className="mt-1 block">{stored.status.zipBytes.toLocaleString("fr-CA")} octets</strong></div><div><span className="text-xs text-slate-500">Date</span><strong className="mt-1 block">{new Date(stored.status.createdAt).toLocaleString("fr-CA")}</strong></div></div><p className="mt-4 break-all text-xs text-slate-500">Identifiant : {stored.manifest.packageId}</p><code className="mt-2 block break-all text-xs text-slate-500">SHA-256 : {stored.status.zipSha256}</code><pre className="mt-4 max-h-96 overflow-auto text-xs">{stored.preview.tree.join("\n")}\n\n{JSON.stringify(stored.manifest, null, 2)}</pre></details></main></LibraryShell>;
}
