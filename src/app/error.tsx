"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("TubeKnowledge render error", error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="max-w-lg rounded-2xl border border-rose-900 bg-rose-950/20 p-8 text-center">
        <p className="text-sm font-semibold text-rose-300">Erreur inattendue</p>
        <h1 className="mt-2 text-2xl font-bold">La page n’a pas pu être affichée.</h1>
        <p className="mt-3 text-slate-400">Vérifiez la configuration de la bibliothèque, puis réessayez.</p>
        <button onClick={reset} className="mt-6 rounded-xl bg-cyan-400 px-4 py-2 font-semibold text-slate-950">
          Réessayer
        </button>
      </div>
    </main>
  );
}
