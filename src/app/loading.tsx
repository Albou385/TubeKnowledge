import { AppHeader } from "@/components/app-header";

export default function Loading() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <AppHeader />
      <main className="mx-auto max-w-4xl animate-pulse px-5 py-12">
        <div className="h-5 w-32 rounded bg-slate-800" />
        <div className="mt-5 h-10 w-2/3 rounded bg-slate-800" />
        <div className="mt-8 space-y-3">
          <div className="h-4 rounded bg-slate-900" />
          <div className="h-4 w-5/6 rounded bg-slate-900" />
          <div className="h-4 w-3/4 rounded bg-slate-900" />
        </div>
        <span className="sr-only">Chargement de la bibliothèque…</span>
      </main>
    </div>
  );
}
