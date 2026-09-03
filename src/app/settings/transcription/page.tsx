import { AppHeader } from "@/components/app-header";
import { TranscriptionSettings } from "@/components/transcription-settings";

export default function TranscriptionSettingsPage() {
  return <div className="min-h-screen bg-slate-50 dark:bg-slate-950"><AppHeader /><main className="mx-auto max-w-4xl px-5 py-10 sm:px-8"><p className="text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase dark:text-cyan-300">Configuration locale</p><h1 className="mt-2 text-3xl font-bold">Transcription</h1><p className="mt-2 mb-8 text-slate-600 dark:text-slate-400">Diagnostic honnête des outils; aucune installation ni aucun téléchargement automatique.</p><TranscriptionSettings /></main></div>;
}

