import Link from "next/link";

import type { LibraryDomainNavigation } from "@/lib/library/library-navigation";

function browseHref(relativePath: string): string {
  return `/browse/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function notionCount(domain: LibraryDomainNavigation): number {
  return domain.directNotions.length + domain.subjects.reduce((count, subject) => count + subject.notions.length, 0);
}

export function LibraryNavigationOverview({ domains }: { domains: LibraryDomainNavigation[] }) {
  if (domains.length === 0) return <p className="mt-8 rounded-xl border border-dashed border-slate-300 p-6 text-slate-500 dark:border-slate-700">Aucun domaine n’est encore disponible.</p>;
  return <section aria-labelledby="library-domains" className="mt-8"><h2 id="library-domains" className="text-2xl font-bold">Domaines</h2><div className="mt-4 grid gap-4 sm:grid-cols-2">
    {domains.map((domain) => <Link key={domain.relativePath} href={browseHref(domain.relativePath)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-500 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <h3 className="break-words text-xl font-semibold">{domain.name}</h3>
      <p className="mt-2 text-sm text-slate-500">{domain.subjects.length} sujet{domain.subjects.length > 1 ? "s" : ""} · {notionCount(domain)} notion{notionCount(domain) > 1 ? "s" : ""}</p>
    </Link>)}
  </div></section>;
}
