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
  return <div className="min-h-screen bg-slate-50 dark:bg-slate-950"><AppHeader /><main className="mx-auto max-w-5xl px-5 py-10 sm:px-8"><h1 className="text-3xl font-bold tracking-tight">Ajouter des vidéos</h1><p className="mt-3 mb-8 max-w-2xl text-slate-600 dark:text-slate-400">Cette page historique utilise le même parcours que Ajouter.</p><VideoQueueDashboard initialQueue={queue} initialError={error} /></main></div>;
}

