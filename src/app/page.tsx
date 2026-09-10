import Link from "next/link";

import { ConfigurationHelp } from "@/components/configuration-help";
import { LibraryShell } from "@/components/library-shell";
import { inspectLibrary } from "@/lib/library/library-reader";

export const dynamic = "force-dynamic";

const actions = [
  { href: "/add-video", label: "Ajouter", description: "Une ou plusieurs vidéos, traitées une à la fois.", tone: "bg-cyan-400 text-slate-950" },
  { href: "/library", label: "Bibliothèque", description: "Retrouvez vos domaines, sujets et notions.", tone: "border border-slate-300 dark:border-slate-700" },
];

export default async function HomePage() {
  const library = await inspectLibrary();
  if (!library.available) return <ConfigurationHelp message={library.message} />;
  return <LibraryShell tree={library.tree}><section className="mx-auto max-w-6xl"><div className="rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.18),transparent_42%)] p-6 sm:p-10 dark:border-slate-800"><p className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">Bibliothèque locale</p><h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl dark:text-white">Transformez une vidéo en connaissance que vous pouvez retrouver.</h1><p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300">Travaillez localement, gardez le contrôle avant chaque écriture et revenez exactement où vous étiez.</p></div>
    <div className="mt-6 grid gap-4 sm:grid-cols-2">{actions.map((action) => <Link key={action.href} href={action.href} className={`rounded-2xl p-6 transition hover:-translate-y-0.5 hover:shadow-lg ${action.tone}`}><strong className="text-xl">{action.label}</strong><span className="mt-2 block text-sm opacity-75">{action.description}</span></Link>)}</div>
  </section></LibraryShell>;
}
