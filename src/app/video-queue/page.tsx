import { AppHeader } from "@/components/app-header";
import { VideoQueueDashboard } from "@/components/video-queue-dashboard";
import { getVideoQueueEngine, type VideoQueueSnapshot } from "@/lib/video-queue/engine";
import { publicVideoQueueError } from "@/lib/video-queue/errors";

export const dynamic = "force-dynamic";

const EMPTY_QUEUE: VideoQueueSnapshot = { revision: 0, paused: false, activeItemId: null, items: [], history: [] };

export default async function VideoQueuePage() {
  let queue = EMPTY_QUEUE;
  let error = "";
  try { queue = await getVideoQueueEngine().snapshot(); }
  catch (cause) { error = publicVideoQueueError(cause).message; }
  return <div className="min-h-screen bg-slate-50 dark:bg-slate-950"><AppHeader /><main className="mx-auto max-w-6xl px-5 py-10 sm:px-8"><p className="text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase dark:text-cyan-300">Backlog ponctuel</p><h1 className="mt-2 text-4xl font-bold tracking-tight">File locale de vidéos</h1><p className="mt-3 mb-8 max-w-3xl text-slate-600 dark:text-slate-400">Ajoutez plusieurs vidéos sans parallélisme. Chaque traitement s’arrête aux décisions humaines et aucune connaissance n’est appliquée automatiquement.</p><VideoQueueDashboard initialQueue={queue} initialError={error} /></main></div>;
}

