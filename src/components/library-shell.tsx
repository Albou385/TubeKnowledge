"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import { AppHeader } from "@/components/app-header";
import { LibraryTree } from "@/components/library-tree";
import type { LibraryNode } from "@/lib/library/types";

export function LibraryShell({
  tree,
  currentPath,
  children,
}: {
  tree: LibraryNode[];
  currentPath?: string;
  children: ReactNode;
}) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <AppHeader navigationOpen={navigationOpen} onMenuToggle={() => setNavigationOpen((open) => !open)} />
      <div className="mx-auto grid max-w-[1500px] grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside id="library-navigation" className={`${navigationOpen ? "block" : "hidden"} border-b border-slate-200 bg-white p-4 lg:sticky lg:top-[73px] lg:block lg:h-[calc(100vh-73px)] lg:overflow-y-auto lg:border-r lg:border-b-0 dark:border-slate-800 dark:bg-slate-950`}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase">
              Bibliothèque
            </h2>
            <span className="text-xs text-slate-600">Markdown</span>
          </div>
          <LibraryTree nodes={tree} currentPath={currentPath} />
        </aside>
        <main className="min-w-0 p-4 sm:p-8 lg:p-10">{children}</main>
      </div>
    </div>
  );
}
