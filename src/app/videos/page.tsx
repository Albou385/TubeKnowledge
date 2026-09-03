import Link from "next/link";

import { ConfigurationHelp } from "@/components/configuration-help";
import { LibraryShell } from "@/components/library-shell";
import { inspectLibrary } from "@/lib/library/library-reader";
import { readVideos } from "@/lib/videos/videos";

export const dynamic = "force-dynamic";

export default async function VideosPage() {
  const library = await inspectLibrary();
  if (!library.available) return <ConfigurationHelp message={library.message} />;

  let videoData: Awaited<ReturnType<typeof readVideos>> | null = null;
  try { videoData = await readVideos(); } catch { /* handled by the visible unavailable state */ }

  return (
    <LibraryShell tree={library.tree} currentPath={videoData?.sourcePath}>
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-semibold tracking-[0.16em] text-cyan-600 uppercase">Sources</p>
        <h1 className="mt-2 text-3xl font-bold">Vidéos</h1>
        <p className="mt-3 text-slate-600 dark:text-slate-400">Vue structurée et strictement en lecture seule de <code>02_SOURCES/videos.md</code>.</p>
        {!videoData ? (
          <p className="mt-8 rounded-xl border border-rose-300 bg-rose-50 p-5 dark:border-rose-900 dark:bg-rose-950/20">Le fichier des vidéos est absent ou illisible.</p>
        ) : videoData.entries.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
            <h2 className="text-lg font-semibold">Aucune vidéo traitée</h2>
            <p className="mt-2 text-sm text-slate-500">La bibliothèque ne contient encore aucune entrée vidéo. TubeKnowledge ne modifie pas ce fichier.</p>
            <Link href={`/library/${videoData.sourcePath.split("/").map(encodeURIComponent).join("/")}`} className="mt-4 inline-block text-sm font-semibold text-cyan-600 dark:text-cyan-300">Voir le document source</Link>
          </div>
        ) : (
          <div className="mt-8 grid gap-4">
            {videoData.entries.map((video, index) => (
              <article key={`${video.title}:${index}`} className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold">{video.title}</h2>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs dark:bg-slate-800">{video.status}</span>
                </div>
                <p className="mt-3 text-sm text-slate-500">Sections : {video.sections.join(", ") || "Non précisées"}</p>
                {video.url ? <a href={video.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-semibold text-cyan-600 dark:text-cyan-300">Ouvrir la vidéo ↗</a> : <p className="mt-3 text-sm text-amber-600">URL absente ou non sécurisée</p>}
              </article>
            ))}
          </div>
        )}
      </div>
    </LibraryShell>
  );
}
