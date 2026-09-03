import Link from "next/link";

import { ConfigurationHelp } from "@/components/configuration-help";
import { LibraryShell } from "@/components/library-shell";
import { inspectLibrary } from "@/lib/library/library-reader";
import { normalizeRelativeLibraryPath } from "@/lib/library/path-security";
import type { LibraryNode } from "@/lib/library/types";

export const dynamic = "force-dynamic";

type BrowsePageProps = { params: Promise<{ slug: string[] }> };

function findDirectory(nodes: LibraryNode[], relativePath: string): Extract<LibraryNode, { type: "directory" }> | null {
  for (const node of nodes) {
    if (node.type !== "directory") continue;
    if (node.relativePath === relativePath) return node;
    const child = findDirectory(node.children, relativePath);
    if (child) return child;
  }
  return null;
}

function nodeHref(node: LibraryNode): string {
  const encoded = node.relativePath.split("/").map(encodeURIComponent).join("/");
  return node.type === "file" ? `/library/${encoded}` : `/browse/${encoded}`;
}

export default async function BrowsePage({ params }: BrowsePageProps) {
  const library = await inspectLibrary();
  if (!library.available) return <ConfigurationHelp message={library.message} />;

  let relativePath: string;
  try {
    relativePath = normalizeRelativeLibraryPath((await params).slug.join("/"));
  } catch {
    relativePath = "";
  }
  const directory = relativePath ? findDirectory(library.tree, relativePath) : null;

  return (
    <LibraryShell tree={library.tree}>
      <div className="mx-auto max-w-5xl">
        <nav aria-label="Fil d’Ariane" className="mb-6 flex flex-wrap gap-2 text-sm text-slate-500">
          <Link href="/" className="hover:text-cyan-600">Accueil</Link>
          {relativePath.split("/").filter(Boolean).map((part, index, parts) => (
            <span key={`${part}:${index}`}>/ <Link className="hover:text-cyan-600" href={`/browse/${parts.slice(0, index + 1).map(encodeURIComponent).join("/")}`}>{part}</Link></span>
          ))}
        </nav>
        {!directory ? (
          <div className="rounded-2xl border border-rose-300 bg-rose-50 p-7 dark:border-rose-900 dark:bg-rose-950/20">
            <h1 className="text-2xl font-bold">Dossier introuvable ou chemin refusé</h1>
          </div>
        ) : (
          <>
            <p className="text-xs font-semibold tracking-[0.16em] text-cyan-600 uppercase">Dossier Markdown</p>
            <h1 className="mt-2 text-3xl font-bold">{directory.name}</h1>
            <p className="mt-2 text-sm text-slate-500">{directory.relativePath}</p>
            {directory.children.length > 0 ? (
              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {directory.children.map((node) => (
                  <Link key={node.relativePath} href={nodeHref(node)} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-cyan-500 dark:border-slate-800 dark:bg-slate-900">
                    <span className="text-xs text-slate-500">{node.type === "file" ? "Document" : "Dossier"}</span>
                    <strong className="mt-1 block">{node.name.replace(/\.md$/i, "")}</strong>
                  </Link>
                ))}
              </div>
            ) : <p className="mt-7 rounded-xl border border-dashed border-slate-300 p-5 text-slate-500 dark:border-slate-700">Ce dossier ne contient aucun document Markdown visible.</p>}
          </>
        )}
      </div>
    </LibraryShell>
  );
}
