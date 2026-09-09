"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { SearchBox } from "@/components/search-box";
import { ThemeToggle } from "@/components/theme-toggle";

const ADVANCED_DESTINATIONS = [
  ["Acquisitions", "/acquisitions"],
  ["Paquets d’analyse", "/chatgpt-packages"],
  ["Imports sécurisés", "/imports"],
  ["Portabilité", "/portability"],
  ["Diagnostic", "/diagnostics"],
  ["Paramètres de transcription", "/settings/transcription"],
] as const;

function AdvancedNavigation() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyboard);
    };
  }, [open]);

  return <div ref={containerRef} className="relative ml-auto shrink-0 sm:ml-0">
    <button ref={buttonRef} type="button" aria-expanded={open} aria-haspopup="menu" aria-controls="advanced-navigation-menu" onClick={() => setOpen((current) => !current)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 outline-none hover:border-cyan-400 hover:text-cyan-700 focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 dark:border-slate-700 dark:text-slate-200 dark:focus-visible:ring-offset-slate-950">
      <span>Avancé</span><span aria-hidden="true" className={`text-xs transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
    </button>
    {open ? <div id="advanced-navigation-menu" role="menu" aria-label="Navigation avancée" className="absolute right-0 z-50 mt-2 grid w-72 max-w-[calc(100vw-2rem)] gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
      {ADVANCED_DESTINATIONS.map(([label, href]) => <Link key={href} href={href} role="menuitem" onClick={() => setOpen(false)} className="rounded-xl px-4 py-3 text-sm font-medium text-slate-700 outline-none hover:bg-cyan-50 hover:text-cyan-800 focus-visible:bg-cyan-100 focus-visible:ring-2 focus-visible:ring-cyan-500 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800">{label}</Link>)}
    </div> : null}
  </div>;
}

export function AppHeader({
  navigationOpen = false,
  onMenuToggle,
}: {
  navigationOpen?: boolean;
  onMenuToggle?: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3">
        {onMenuToggle ? (
          <button
            type="button"
            onClick={onMenuToggle}
            className="grid size-10 place-items-center rounded-xl border border-slate-300 lg:hidden dark:border-slate-700"
            aria-label={navigationOpen ? "Fermer la navigation" : "Ouvrir la navigation"}
            aria-expanded={navigationOpen}
            aria-controls="library-navigation"
          >
            <span aria-hidden="true">☰</span>
          </button>
        ) : null}
        <Link href="/" className="flex items-center gap-3" aria-label="Accueil TubeKnowledge">
          <span className="grid size-10 place-items-center rounded-xl bg-cyan-400 font-black text-slate-950">
            TK
          </span>
          <span className="hidden sm:block">
            <strong className="block text-base tracking-tight text-slate-950 dark:text-slate-50">TubeKnowledge</strong>
            <span className="block text-xs text-slate-400">Bibliothèque locale · lecture seule</span>
          </span>
        </Link>
        <nav aria-label="Navigation principale" className="order-3 flex w-full items-center gap-4 overflow-x-auto text-sm sm:order-none sm:w-auto">
          <Link href="/add-video" className="shrink-0 font-semibold text-cyan-700 hover:text-cyan-600 dark:text-cyan-300">Ajouter</Link>
          <Link href="/video-queue" className="shrink-0 text-slate-600 hover:text-cyan-600 dark:text-slate-300 dark:hover:text-cyan-300">File</Link>
          <Link href="/workflows" className="shrink-0 text-slate-600 hover:text-cyan-600 dark:text-slate-300 dark:hover:text-cyan-300">Traitements</Link>
          <Link href="/ask" className="shrink-0 font-semibold text-violet-700 hover:text-violet-600 dark:text-violet-300">Question</Link>
          <Link href="/library" className="shrink-0 text-slate-600 hover:text-cyan-600 dark:text-slate-300 dark:hover:text-cyan-300">Bibliothèque</Link>
        </nav>
        <AdvancedNavigation />
        <div className="order-4 w-full flex-1 sm:order-none sm:min-w-64"><SearchBox /></div>
        <ThemeToggle />
      </div>
    </header>
  );
}
