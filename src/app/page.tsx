import Link from "next/link";

import { ConfigurationHelp } from "@/components/configuration-help";
import { LibraryShell } from "@/components/library-shell";
import { inspectLibrary } from "@/lib/library/library-reader";
import { readVideos } from "@/lib/videos/videos";
import { listWorkflows } from "@/lib/workflows/runtime";

export const dynamic = "force-dynamic";

const actions = [
  { href: "/add-video", label: "Ajouter une vidéo", description: "De l’URL à la connaissance, avec reprise locale.", tone: "bg-cyan-400 text-slate-950" },
  { href: "/workflows", label: "Continuer un traitement", description: "Retrouver une transcription, une analyse ou une vérification.", tone: "bg-slate-900 text-white dark:bg-white dark:text-slate-950" },
  { href: "/ask", label: "Poser une question", description: "Réponse locale avec passages et citations vérifiables.", tone: "bg-violet-500 text-white" },
  { href: "/library", label: "Ouvrir la bibliothèque", description: "Explorer les domaines, sujets et notions Markdown.", tone: "border border-slate-300 dark:border-slate-700" },
];

export default async function HomePage() {
  const library = await inspectLibrary();
  if (!library.available) return <ConfigurationHelp message={library.message} />;
  const [workflows, videoEntries] = await Promise.all([
    listWorkflows().catch(() => []),
    readVideos().then((result) => result.entries).catch(() => []),
  ]);

  return <LibraryShell tree={library.tree}><section className="mx-auto max-w-6xl"><div className="rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.18),transparent_42%)] p-6 sm:p-10 dark:border-slate-800"><p className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">Bibliothèque locale</p><h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl dark:text-white">Transformez une vidéo en connaissance que vous pouvez retrouver.</h1><p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300">Travaillez localement, gardez le contrôle avant chaque écriture et revenez exactement où vous étiez.</p></div>
    <div className="mt-6 grid gap-4 sm:grid-cols-2">{actions.map((action) => <Link key={action.href} href={action.href} className={`rounded-2xl p-6 transition hover:-translate-y-0.5 hover:shadow-lg ${action.tone}`}><strong className="text-xl">{action.label}</strong><span className="mt-2 block text-sm opacity-75">{action.description}</span></Link>)}</div>
    <div className="mt-8 grid gap-6 lg:grid-cols-2"><section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between"><h2 className="text-xl font-bold">À reprendre</h2><Link href="/workflows" className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">Tout voir →</Link></div><div className="mt-4 space-y-3">{workflows.slice(0, 3).map((workflow) => <Link key={workflow.workflowId} href={`/workflows/${workflow.workflowId}`} className="block rounded-xl bg-slate-50 p-4 dark:bg-slate-950"><strong>{workflow.title ?? "Vidéo à inspecter"}</strong><span className="mt-1 block text-sm text-slate-500">{workflow.nextAction}</span></Link>)}{!workflows.length ? <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500 dark:border-slate-700">Aucun traitement en cours. Commencez par une URL YouTube.</p> : null}</div></section>
    <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between"><h2 className="text-xl font-bold">Dernières vidéos</h2><Link href="/videos" className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">Bibliothèque →</Link></div><div className="mt-4 space-y-3">{videoEntries.slice(-3).reverse().map((video) => <article key={`${video.title}-${video.url}`} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-950"><strong>{video.title}</strong><span className="mt-1 block text-sm text-slate-500">{video.status}</span></article>)}{!videoEntries.length ? <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500 dark:border-slate-700">Aucune vidéo indexée pour le moment.</p> : null}</div></section></div>
    <p className="mt-8 text-center text-xs text-slate-500">{library.stats.markdownFiles} fichiers Markdown · <Link href="/diagnostics" className="underline">état local</Link> · aucune synchronisation cloud déduite</p>
  </section></LibraryShell>;
}
