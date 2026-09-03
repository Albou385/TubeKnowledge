import { AppHeader } from "@/components/app-header";
import { LibraryAssistant } from "@/components/library-assistant";
import { listAssistantHistory } from "@/lib/library-assistant/history";

export const dynamic = "force-dynamic";

export default async function AskLibraryPage() {
  return <div className="min-h-screen bg-slate-50 dark:bg-slate-950"><AppHeader /><main className="mx-auto max-w-5xl px-5 py-10 sm:px-8"><p className="text-xs font-semibold tracking-[0.16em] text-violet-700 uppercase dark:text-violet-300">Bibliothèque locale</p><h1 className="mt-2 text-4xl font-bold tracking-tight">Poser une question à ma bibliothèque</h1><p className="mt-3 mb-8 max-w-2xl text-slate-600 dark:text-slate-400">Localisez les documents pertinents, vérifiez les passages et ouvrez chaque source. L’IA reste facultative.</p><LibraryAssistant initialHistory={(await listAssistantHistory()).slice(0, 8)} /></main></div>;
}
