import { AppHeader } from "@/components/app-header";
import { VideoQueueDashboard } from "@/components/video-queue-dashboard";
import { getVideoQueueEngine, type VideoQueueSnapshot } from "@/lib/video-queue/engine";
import { publicVideoQueueError } from "@/lib/video-queue/errors";

export const dynamic = "force-dynamic";

const EMPTY_QUEUE: VideoQueueSnapshot = { revision: 0, paused: false, activeItemId: null, items: [], history: [] };

export default async function AddVideoPage() {
  let queue = EMPTY_QUEUE;
  let error = "";
  try { queue = await getVideoQueueEngine().snapshot(); }
  catch (cause) { error = publicVideoQueueError(cause).message; }
  return <div className="min-h-screen bg-slate-50 dark:bg-slate-950"><AppHeader /><main className="mx-auto max-w-5xl px-5 py-10 sm:px-8"><div><h1 className="text-4xl font-bold tracking-tight">Ajouter des vidéos</h1><p className="mt-3 max-w-2xl text-slate-600 dark:text-slate-400">Collez une ou plusieurs URL YouTube, une par ligne. Chaque vidéo est traitée à son tour et ses connaissances sont rangées dans votre bibliothèque.</p></div><div className="mt-8"><VideoQueueDashboard initialQueue={queue} initialError={error} /></div></main></div>;
}
