import Link from "next/link";

import type { LibraryDomainNavigation, LibraryNotionNavigation } from "@/lib/library/library-navigation";

function browseHref(relativePath: string): string {
  return `/browse/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function documentHref(relativePath: string): string {
  return `/library/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function NotionCard({ notion }: { notion: LibraryNotionNavigation }) {
  return <article className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
    <p className="text-xs font-semibold tracking-[0.14em] text-cyan-700 uppercase dark:text-cyan-300">Notion</p>
    <Link href={documentHref(notion.relativePath)} className="mt-1 block text-lg font-semibold hover:text-cyan-700 dark:hover:text-cyan-300">{notion.title}</Link>
    {notion.summary ? <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{notion.summary}</p> : null}
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
      {notion.sourceCount !== null ? <span>{notion.sourceCount} source{notion.sourceCount > 1 ? "s" : ""} vidéo</span> : null}
      {notion.relatedNotions.length > 0 ? <span>{notion.relatedNotions.length} notion{notion.relatedNotions.length > 1 ? "s" : ""} liée{notion.relatedNotions.length > 1 ? "s" : ""}</span> : null}
    </div>
    {notion.relatedNotions.length > 0 ? <ul aria-label={`Notions liées à ${notion.title}`} className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {notion.relatedNotions.map((related) => <li key={related.relativePath}><Link href={documentHref(related.relativePath)} className="text-violet-700 underline underline-offset-2 hover:text-violet-600 dark:text-violet-300">{related.title}</Link></li>)}
    </ul> : null}
  </article>;
}

export function LibraryNavigationOverview({ domains }: { domains: LibraryDomainNavigation[] }) {
  if (domains.length === 0) return <p className="mt-8 rounded-xl border border-dashed border-slate-300 p-6 text-slate-500 dark:border-slate-700">Aucun domaine lisible n’est présent sous <code>01_BIBLIOTHEQUE</code>.</p>;
  return <div className="mt-8 space-y-8">
    {domains.map((domain) => <section key={domain.relativePath} aria-labelledby={`domain-${domain.relativePath.replaceAll("/", "-")}`} className="rounded-2xl border border-slate-200 p-5 dark:border-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase dark:text-cyan-300">Domaine</p><h2 id={`domain-${domain.relativePath.replaceAll("/", "-")}`} className="mt-1 text-2xl font-bold"><Link href={browseHref(domain.relativePath)} className="hover:text-cyan-700 dark:hover:text-cyan-300">{domain.name}</Link></h2></div>
        <span className="text-sm text-slate-500">{domain.subjects.length} sujet{domain.subjects.length > 1 ? "s" : ""} · {domain.directNotions.length + domain.subjects.reduce((count, subject) => count + subject.notions.length, 0)} notion{domain.directNotions.length + domain.subjects.reduce((count, subject) => count + subject.notions.length, 0) > 1 ? "s" : ""}</span>
      </div>
      {domain.subjects.map((subject) => <section key={subject.relativePath} aria-labelledby={`subject-${subject.relativePath.replaceAll("/", "-")}`} className="mt-6 border-l-2 border-cyan-200 pl-4 dark:border-cyan-900">
        <p className="text-xs font-semibold tracking-[0.14em] text-slate-500 uppercase">Sujet</p>
        <h3 id={`subject-${subject.relativePath.replaceAll("/", "-")}`} className="mt-1 text-lg font-semibold"><Link href={browseHref(subject.relativePath)} className="hover:text-cyan-700 dark:hover:text-cyan-300">{subject.name}</Link></h3>
        {subject.notions.length > 0 ? <div className="mt-3 grid gap-3 lg:grid-cols-2">{subject.notions.map((notion) => <NotionCard key={notion.relativePath} notion={notion} />)}</div> : <p className="mt-2 text-sm text-slate-500">Aucune notion lisible dans ce sujet.</p>}
      </section>)}
      {domain.directNotions.length > 0 ? <section className="mt-6 border-l-2 border-slate-200 pl-4 dark:border-slate-700"><p className="text-xs font-semibold tracking-[0.14em] text-slate-500 uppercase">Notions directement classées</p><div className="mt-3 grid gap-3 lg:grid-cols-2">{domain.directNotions.map((notion) => <NotionCard key={notion.relativePath} notion={notion} />)}</div></section> : null}
    </section>)}
  </div>;
}
