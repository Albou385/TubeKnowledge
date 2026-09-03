import Link from "next/link";

import { ConfigurationHelp } from "@/components/configuration-help";
import { LibraryShell } from "@/components/library-shell";
import { getArtificialIntelligenceView } from "@/lib/artificial-intelligence/ai-view";
import { inspectLibrary } from "@/lib/library/library-reader";

export const dynamic = "force-dynamic";

function documentHref(relativePath: string): string {
  return `/library/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

export default async function ArtificialIntelligencePage() {
  const library = await inspectLibrary();
  if (!library.available) return <ConfigurationHelp message={library.message} />;
  const view = await getArtificialIntelligenceView();

  return (
    <LibraryShell tree={library.tree} currentPath={view.index?.relativePath}>
      <div className="mx-auto max-w-6xl">
        <p className="text-xs font-semibold tracking-[0.16em] text-violet-600 uppercase">Vue spécialisée</p>
        <h1 className="mt-2 text-3xl font-bold">Intelligence artificielle</h1>
        <p className="mt-3 text-slate-600 dark:text-slate-400">Une présentation des documents réellement présents dans la section, sans contenu parallèle.</p>

        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-semibold">Index de la section</h2>
            {view.index ? <Link href={documentHref(view.index.relativePath)} className="mt-3 inline-block text-cyan-600 dark:text-cyan-300">{view.index.title} →</Link> : <p className="mt-3 text-sm text-slate-500">Aucun index disponible.</p>}
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-semibold">Sous-sections</h2>
            {view.subsections.length > 0 ? <ul className="mt-3 space-y-2">{view.subsections.map((section) => <li key={section.relativePath}><Link href={`/browse/${section.relativePath.split("/").map(encodeURIComponent).join("/")}`} className="text-cyan-600 dark:text-cyan-300">{section.name}</Link> <span className="text-xs text-slate-500">({section.documentCount})</span></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">Aucune sous-section disponible.</p>}
          </section>
        </div>

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-semibold">Notions disponibles</h2>
          {view.notions.length > 0 ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{view.notions.map((notion) => <Link key={notion.relativePath} href={documentHref(notion.relativePath)} className="rounded-lg border border-slate-200 p-3 hover:border-cyan-500 dark:border-slate-700">{notion.title}</Link>)}</div> : <p className="mt-3 text-sm text-slate-500">Les sous-sections ne contiennent encore aucun fichier de notion.</p>}
        </section>

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-semibold">Documents récemment modifiés</h2>
          {view.recentDocuments.length > 0 ? <ul className="mt-3 divide-y divide-slate-200 dark:divide-slate-800">{view.recentDocuments.map((document) => <li key={document.relativePath} className="flex flex-wrap justify-between gap-2 py-3"><Link href={documentHref(document.relativePath)} className="text-cyan-600 dark:text-cyan-300">{document.title}</Link><time className="text-xs text-slate-500">{new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium" }).format(new Date(document.lastModified))}</time></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">Aucun document disponible.</p>}
        </section>
      </div>
    </LibraryShell>
  );
}
