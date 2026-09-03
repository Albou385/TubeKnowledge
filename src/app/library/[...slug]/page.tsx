import type { Metadata } from "next";
import Link from "next/link";

import { ConfigurationHelp } from "@/components/configuration-help";
import { LibraryShell } from "@/components/library-shell";
import { MarkdownArticle } from "@/components/markdown-article";
import { inspectLibrary, readMarkdownDocument } from "@/lib/library/library-reader";
import type { MarkdownDocument } from "@/lib/library/types";
import { buildObsidianUrl, getObsidianVaultName } from "@/lib/obsidian/obsidian";

export const dynamic = "force-dynamic";

type LibraryPageProps = { params: Promise<{ slug: string[] }> };

export async function generateMetadata({ params }: LibraryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const fallbackTitle = slug.at(-1)?.replace(/\.md$/i, "") || "Document";
  return { title: fallbackTitle };
}

export default async function LibraryPage({ params }: LibraryPageProps) {
  const library = await inspectLibrary();
  if (!library.available) {
    return <ConfigurationHelp message={library.message} />;
  }

  const { slug } = await params;
  const requestedPath = slug.join("/");
  let document: MarkdownDocument;

  try {
    document = await readMarkdownDocument(requestedPath);
  } catch {
    return (
      <LibraryShell tree={library.tree}>
        <div className="mx-auto max-w-2xl rounded-2xl border border-rose-900/70 bg-rose-950/20 p-7">
          <p className="text-sm font-semibold text-rose-300">Lecture impossible</p>
          <h1 className="mt-2 text-2xl font-bold text-white">Document introuvable ou chemin refusé</h1>
          <p className="mt-3 text-slate-400">
            Seuls les fichiers Markdown situés dans la bibliothèque configurée peuvent être ouverts.
          </p>
          <Link href="/" className="mt-6 inline-block text-sm font-semibold text-cyan-300 hover:text-cyan-200">
            Retour à l’accueil
          </Link>
        </div>
      </LibraryShell>
    );
  }

  const crumbs = document.relativePath.split("/");
  const obsidianUrl = buildObsidianUrl(getObsidianVaultName(), document.relativePath);
  const formattedDate = new Intl.DateTimeFormat("fr-CA", { dateStyle: "long", timeStyle: "short" }).format(new Date(document.lastModified));

  return (
    <LibraryShell tree={library.tree} currentPath={document.relativePath}>
      <div className="mx-auto max-w-6xl">
        <nav aria-label="Fil d’Ariane" className="mb-6 flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <Link href="/" className="hover:text-cyan-300">Accueil</Link>
          {crumbs.map((crumb, index) => {
            const isDocument = index === crumbs.length - 1;
            const logicalPath = crumbs.slice(0, index + 1).map(encodeURIComponent).join("/");
            return (
              <span key={`${crumb}:${index}`} className="flex items-center gap-2">
                <span aria-hidden="true">/</span>
                {isDocument ? (
                  <span className="text-slate-700 dark:text-slate-300">{crumb.replace(/\.md$/i, "")}</span>
                ) : (
                  <Link href={`/browse/${logicalPath}`} className="hover:text-cyan-600 dark:hover:text-cyan-300">{crumb}</Link>
                )}
              </span>
            );
          })}
        </nav>

        <header className="mb-8 border-b border-slate-200 pb-6 dark:border-slate-800">
          <p className="text-xs font-semibold tracking-[0.16em] text-cyan-400 uppercase">Document Markdown</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl dark:text-white">{document.title}</h1>
          <p className="mt-2 break-all text-sm text-slate-500">{document.relativePath}</p>
          <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
            <div><dt className="inline font-semibold">Section :</dt> <dd className="inline">{document.section}</dd></div>
            <div><dt className="inline font-semibold">Modifié :</dt> <dd className="inline">{formattedDate}</dd></div>
            <div><dt className="inline font-semibold">Volume :</dt> <dd className="inline">environ {document.wordCount} mots</dd></div>
          </dl>
          {obsidianUrl ? (
            <a href={obsidianUrl} className="mt-5 inline-flex rounded-lg border border-violet-300 px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950">
              Ouvrir dans Obsidian
            </a>
          ) : (
            <span className="mt-5 inline-block text-xs text-slate-500">Ouverture Obsidian non configurée</span>
          )}
        </header>

        <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_240px]">
          <MarkdownArticle content={document.content} />
          <aside aria-label="Table des matières" className="xl:order-none">
            <details className="rounded-xl border border-slate-200 bg-white p-4 xl:sticky xl:top-28 xl:block dark:border-slate-800 dark:bg-slate-900/50" open>
              <summary className="cursor-pointer text-sm font-semibold text-slate-900 xl:cursor-default dark:text-white">Dans ce document</summary>
              {document.headings.length > 0 ? (
                <ol className="mt-3 space-y-2 text-sm">
                  {document.headings.map((heading) => (
                    <li key={heading.id} className={heading.level === 3 ? "ml-4" : undefined}>
                      <a href={`#${heading.id}`} className="text-slate-600 hover:text-cyan-600 dark:text-slate-400 dark:hover:text-cyan-300">{heading.text}</a>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 text-sm text-slate-500">Aucun titre secondaire.</p>
              )}
            </details>
          </aside>
        </div>
      </div>
    </LibraryShell>
  );
}
