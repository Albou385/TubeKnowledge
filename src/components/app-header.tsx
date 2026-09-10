"use client";

import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";

const ADVANCED_DESTINATIONS = [
  ["Traitements", "/workflows"],
  ["Imports", "/imports"],
  ["Portabilité", "/portability"],
  ["Diagnostic", "/diagnostics"],
  ["Paramètres", "/settings/transcription"],
] as const;

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 px-3 py-3 backdrop-blur sm:px-4 dark:border-slate-800 dark:bg-slate-950/95">
      <div className="mx-auto flex max-w-6xl items-center gap-2 sm:gap-4">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="Accueil TubeKnowledge">
          <span className="grid size-9 place-items-center rounded-xl bg-cyan-400 text-sm font-black text-slate-950">TK</span>
          <strong className="hidden text-base tracking-tight text-slate-950 sm:block dark:text-slate-50">TubeKnowledge</strong>
        </Link>
        <nav aria-label="Navigation principale" className="flex min-w-0 items-center gap-3 text-sm sm:gap-4">
          <Link href="/add-video" className="shrink-0 font-semibold text-cyan-700 hover:text-cyan-600 dark:text-cyan-300">Ajouter</Link>
          <Link href="/library" className="shrink-0 font-semibold text-slate-700 hover:text-cyan-600 dark:text-slate-200 dark:hover:text-cyan-300">Bibliothèque</Link>
        </nav>
        <details className="relative ml-auto shrink-0">
          <summary aria-label="Ouvrir les réglages" className="grid size-9 cursor-pointer list-none place-items-center rounded-xl border border-slate-300 text-sm text-slate-600 hover:border-cyan-400 hover:text-cyan-700 dark:border-slate-700 dark:text-slate-300">
            <span aria-hidden="true">⚙</span>
          </summary>
          <div className="absolute right-0 z-50 mt-2 grid w-56 gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            {ADVANCED_DESTINATIONS.map(([label, href]) => <Link key={href} href={href} className="rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-cyan-50 hover:text-cyan-800 dark:text-slate-200 dark:hover:bg-slate-800">{label}</Link>)}
          </div>
        </details>
        <ThemeToggle />
      </div>
    </header>
  );
}
