"use client";

import Link from "next/link";
import { KeyboardEvent, useEffect, useRef } from "react";

import type { LibraryNode } from "@/lib/library/types";

function libraryHref(relativePath: string): string {
  return `/library/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function nodeKind(node: LibraryNode, depth: number, semantic: boolean): string {
  if (!semantic) return node.type === "directory" ? "" : "";
  if (node.type === "directory") return depth === 0 ? "Domaine" : depth === 1 ? "Sujet" : "Dossier";
  return node.name.toLocaleLowerCase("fr") === "index.md" ? "Index" : depth >= 2 ? "Notion" : "Document";
}

function TreeNodes({ nodes, currentPath, onSectionToggle, depth = 0, semantic = false }: { nodes: LibraryNode[]; currentPath?: string; onSectionToggle: () => void; depth?: number; semantic?: boolean }) {
  return (
    <ul className="space-y-1">
      {nodes.map((node) =>
        node.type === "directory" ? (
          <li key={`directory:${node.relativePath}`}>
            <details className="tree-directory" data-path={node.relativePath} open={Boolean(currentPath?.startsWith(`${node.relativePath}/`))} onToggle={onSectionToggle}>
              <summary className="cursor-pointer rounded-lg px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                <span aria-hidden="true">▸</span> {semantic ? <span><span className="mr-1 text-[10px] font-bold tracking-wide text-cyan-700 uppercase dark:text-cyan-300">{nodeKind(node, depth, semantic)}</span>{node.name}</span> : node.name}
              </summary>
              <div className="ml-3 border-l border-slate-200 pl-2 dark:border-slate-800">
                {node.children.length > 0 ? (
                  <TreeNodes nodes={node.children} currentPath={currentPath} onSectionToggle={onSectionToggle} depth={depth + 1} semantic={semantic} />
                ) : (
                  <p className="px-2 py-1 text-xs text-slate-600">Dossier vide</p>
                )}
              </div>
            </details>
          </li>
        ) : (
          <li key={`file:${node.relativePath}`}>
            <Link
              href={libraryHref(node.relativePath)}
              aria-current={currentPath === node.relativePath ? "page" : undefined}
              className="block rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-950 aria-[current=page]:bg-cyan-100 aria-[current=page]:text-cyan-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:aria-[current=page]:bg-cyan-950 dark:aria-[current=page]:text-cyan-200"
            >
              <span aria-hidden="true">◇</span> {semantic ? <span><span className="mr-1 text-[10px] font-bold tracking-wide text-cyan-700 uppercase dark:text-cyan-300">{nodeKind(node, depth, semantic)}</span>{node.name.replace(/\.md$/i, "")}</span> : node.name.replace(/\.md$/i, "")}
            </Link>
          </li>
        ),
      )}
    </ul>
  );
}

export function LibraryTree({ nodes, currentPath }: { nodes: LibraryNode[]; currentPath?: string }) {
  const navigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let saved = new Set<string>();
    try {
      const value: unknown = JSON.parse(window.localStorage.getItem("tubeknowledge-open-sections") ?? "[]");
      if (Array.isArray(value)) saved = new Set(value.filter((item): item is string => typeof item === "string"));
    } catch {
      window.localStorage.removeItem("tubeknowledge-open-sections");
    }
    navigationRef.current?.querySelectorAll<HTMLDetailsElement>("details[data-path]").forEach((details) => {
      if (saved.has(details.dataset.path ?? "")) details.open = true;
    });
  }, []);

  function saveOpenSections() {
    window.setTimeout(() => {
      const openPaths = Array.from(navigationRef.current?.querySelectorAll<HTMLDetailsElement>("details[open][data-path]") ?? [])
        .map((details) => details.dataset.path)
        .filter((value): value is string => Boolean(value));
      window.localStorage.setItem("tubeknowledge-open-sections", JSON.stringify(openPaths));
    });
  }

  function handleKeyboard(event: KeyboardEvent<HTMLElement>) {
    const targets = Array.from(navigationRef.current?.querySelectorAll<HTMLElement>("summary, a") ?? [])
      .filter((target) => target.getClientRects().length > 0);
    const currentIndex = targets.indexOf(event.target as HTMLElement);
    if (currentIndex < 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      targets[(currentIndex + offset + targets.length) % targets.length]?.focus();
    }
    if (event.target instanceof HTMLElement && event.target.tagName === "SUMMARY") {
      const details = event.target.parentElement as HTMLDetailsElement;
      if (event.key === "ArrowRight") details.open = true;
      if (event.key === "ArrowLeft") details.open = false;
    }
  }

  const knowledge = nodes.find((node): node is Extract<LibraryNode, { type: "directory" }> => node.type === "directory" && node.relativePath === "01_BIBLIOTHEQUE");
  const otherNodes = nodes.filter((node) => node !== knowledge);

  return (
    <nav ref={navigationRef} aria-label="Arborescence de la bibliothèque" onKeyDown={handleKeyboard}>
      {knowledge ? (
        <>
          <p className="mb-2 text-[10px] font-bold tracking-[0.14em] text-slate-500 uppercase">Parcours de lecture</p>
          <TreeNodes nodes={knowledge.children} currentPath={currentPath} onSectionToggle={saveOpenSections} semantic />
          {otherNodes.length > 0 ? <details className="mt-4"><summary className="cursor-pointer rounded-lg px-2 py-1.5 text-xs font-semibold tracking-[0.12em] text-slate-500 uppercase">Autres documents</summary><div className="mt-2"><TreeNodes nodes={otherNodes} currentPath={currentPath} onSectionToggle={saveOpenSections} /></div></details> : null}
        </>
      ) : nodes.length > 0 ? (
        <TreeNodes nodes={nodes} currentPath={currentPath} onSectionToggle={saveOpenSections} />
      ) : (
        <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-500">
          Aucun fichier Markdown visible.
        </p>
      )}
    </nav>
  );
}
