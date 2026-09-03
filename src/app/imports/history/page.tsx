import { ConfigurationHelp } from "@/components/configuration-help";
import { LibraryShell } from "@/components/library-shell";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { readImportHistory } from "@/lib/imports/history";
import { inspectLibrary } from "@/lib/library/library-reader";

export const dynamic = "force-dynamic";

export default async function ImportHistoryPage() {
  const library = await inspectLibrary();
  if (!library.available) return <ConfigurationHelp message={library.message} />;
  const config = parseLibraryConfig();
  const history = config.ok ? await readImportHistory(config.rootPath) : [];
  return <LibraryShell tree={library.tree}><div className="mx-auto max-w-5xl"><p className="text-xs font-semibold text-cyan-600 uppercase">Lecture seule</p><h1 className="mt-2 text-3xl font-bold">Historique des imports</h1>{history.length === 0 ? <p className="mt-8 rounded-xl border border-dashed border-slate-300 p-6 text-slate-500 dark:border-slate-700">Aucun import enregistré.</p> : <div className="mt-8 space-y-4">{history.map((entry) => <article key={entry.importId} className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap justify-between gap-3"><strong>{entry.source.title}</strong><span>{entry.status}</span></div><p className="mt-2 text-sm text-slate-500">{new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.timestamp))} · {entry.message}</p><p className="mt-2 text-xs">Créés : {entry.filesCreated.length} · Remplacés : {entry.filesReplaced.length} · Backup : {entry.backupId ?? "aucun"}</p></article>)}</div>}</div></LibraryShell>;
}
