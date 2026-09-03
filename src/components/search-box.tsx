"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

import type { SearchResult } from "@/lib/library/types";
import { MAX_SEARCH_QUERY_LENGTH } from "@/lib/search/search-schema";

function libraryHref(relativePath: string): string {
  return `/library/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

export function SearchBox() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new FormData(event.currentTarget).get("q")?.toString().trim() ?? "";
    if (!query) {
      setResults([]);
      setStatus("done");
      setMessage("Saisissez un terme à rechercher.");
      return;
    }

    setStatus("loading");
    setMessage("");
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const payload = await response.json() as { results?: SearchResult[]; error?: string };
      if (!response.ok) throw new Error(payload.error);
      const nextResults = payload.results ?? [];
      setResults(nextResults);
      setStatus("done");
      setMessage(nextResults.length === 0 ? "Aucun document ne correspond à cette recherche." : "");
    } catch (error) {
      setResults([]);
      setStatus("error");
      setMessage(error instanceof Error && error.message ? error.message : "La recherche est indisponible.");
    }
  }

  const showPanel = status !== "idle";

  return (
    <form onSubmit={submitSearch} role="search" className="relative w-full max-w-xl">
      <label htmlFor="global-search" className="sr-only">Rechercher dans la bibliothèque</label>
      <div className="flex rounded-xl border border-slate-300 bg-white shadow-sm focus-within:border-cyan-500 dark:border-slate-700 dark:bg-slate-900">
        <input
          ref={inputRef}
          id="global-search"
          name="q"
          type="search"
          maxLength={MAX_SEARCH_QUERY_LENGTH}
          placeholder="Rechercher…"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-500 dark:text-slate-100"
          onFocus={() => {
            if (status === "idle" && results.length > 0) setStatus("done");
          }}
        />
        <kbd className="m-1.5 hidden rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500 sm:block dark:border-slate-700">
          Ctrl K
        </kbd>
        <button type="submit" className="m-1 rounded-lg bg-cyan-500 px-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
          Chercher
        </button>
      </div>
      {showPanel ? (
        <div className="absolute right-0 left-0 z-50 mt-2 max-h-[60vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between px-2 py-1">
            <p aria-live="polite" className="text-xs text-slate-500">
              {status === "loading" ? "Recherche en cours…" : message || `${results.length} résultat${results.length > 1 ? "s" : ""}`}
            </p>
            <button type="button" onClick={() => setStatus("idle")} className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">
              Fermer
            </button>
          </div>
          {results.map((result) => (
            <Link
              key={result.relativePath}
              href={libraryHref(result.relativePath)}
              onClick={() => setStatus("idle")}
              className="block rounded-lg px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{result.title}</span>
              <span className="mt-0.5 block text-xs text-cyan-700 dark:text-cyan-300">{result.section} · {result.relativePath}</span>
              <span className="mt-1 line-clamp-2 block text-xs leading-5 text-slate-600 dark:text-slate-400">{result.excerpt}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </form>
  );
}
