"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AddVideoResult, VideoQueueSnapshot } from "@/lib/video-queue/engine";
import type { VideoQueueItem } from "@/lib/video-queue/schema";
import {
  ADD_RESULT_TITLES,
  VIDEO_QUEUE_STATE_LABELS,
  VIDEO_QUEUE_STATE_TONES,
  groupAddResults,
  parseQueueInput,
  publicQueueItemError,
  queueNextAction,
  safeVideoLabel,
  workflowActionLabel,
} from "@/lib/video-queue/ui";

function commandKey(action: string): string {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `video-queue:${action}:${id}`;
}

function resultWorkflowId(result: AddVideoResult): string | undefined {
  return result.duplicates?.find((duplicate) => duplicate.workflowId)?.workflowId;
}

function QueueItemCard({ item, pending, onCancel, onRetry }: { item: VideoQueueItem; pending: boolean; onCancel: () => void; onRetry: () => void }) {
  const error = publicQueueItemError(item.lastErrorCode);
  const cancellable = !["cancelled", "imported"].includes(item.state);
  return <article data-queue-state={item.state} aria-busy={pending} className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="truncate text-lg font-bold">{item.title ?? "Vidéo YouTube"}</h3>
        <a href={item.canonicalUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm text-slate-500 underline-offset-4 hover:underline">{safeVideoLabel(item.videoId)}</a>
      </div>
      <span className={`max-w-full shrink-0 rounded-full px-3 py-1 text-xs font-bold ${VIDEO_QUEUE_STATE_TONES[item.state]}`}>{VIDEO_QUEUE_STATE_LABELS[item.state]}</span>
    </div>
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
      <div><dt className="font-semibold text-slate-500">Ajoutée</dt><dd>{new Date(item.createdAt).toLocaleString("fr-CA")}</dd></div>
      <div><dt className="font-semibold text-slate-500">Prochaine action</dt><dd>{queueNextAction(item)}</dd></div>
    </dl>
    {error ? <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">{error}</p> : null}
    <div className="mt-5 flex flex-wrap gap-3">
      {item.workflowId ? <Link href={`/workflows/${item.workflowId}`} className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950 outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900">{workflowActionLabel(item)}</Link> : null}
      {item.state === "failed" ? <button type="button" disabled={pending} onClick={onRetry} className="rounded-xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-800 disabled:opacity-50 dark:border-rose-800 dark:text-rose-200">{pending ? "Reprise…" : "Réessayer"}</button> : null}
      {cancellable ? <button type="button" disabled={pending} onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50 dark:border-slate-700">{pending ? "Action en cours…" : "Annuler"}</button> : null}
    </div>
  </article>;
}

export function VideoQueueDashboard({ initialQueue, initialError = "" }: { initialQueue: VideoQueueSnapshot; initialError?: string }) {
  const [queue, setQueue] = useState(initialQueue);
  const [input, setInput] = useState("");
  const [results, setResults] = useState<AddVideoResult[]>([]);
  const [status, setStatus] = useState(initialError);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  const resultsRef = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => parseQueueInput(input), [input]);
  const grouped = useMemo(() => groupAddResults(results), [results]);

  const markPending = useCallback((key: string, active: boolean) => {
    if (active) inFlight.current.add(key); else inFlight.current.delete(key);
    setPending(new Set(inFlight.current));
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current.has("refresh")) return;
    markPending("refresh", true);
    try {
      const response = await fetch("/api/video-queue", { method: "GET" });
      const payload = await response.json() as { queue?: VideoQueueSnapshot };
      if (response.ok && payload.queue) setQueue(payload.queue);
      else setStatus("L’état de la file est momentanément indisponible.");
    } catch { setStatus("L’état de la file est momentanément indisponible."); }
    finally { markPending("refresh", false); }
  }, [markPending]);

  // Une seule lecture rafraîchit le rendu après navigation. Elle ne déclenche
  // aucune progression: le runner serveur reste l'unique moteur de la file.
  useEffect(() => {
    const task = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(task);
  }, [refresh]);

  async function mutate(key: string, endpoint: string, successMessage: string) {
    if (inFlight.current.has(key)) return;
    markPending(key, true); setStatus("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: commandKey(key) }) });
      const payload = await response.json() as { queue?: VideoQueueSnapshot; error?: { message?: string } };
      if (!response.ok || !payload.queue) throw new Error(payload.error?.message ?? "Action impossible.");
      setQueue(payload.queue); setStatus(successMessage);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Action impossible. Réessayez."); }
    finally { markPending(key, false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (parsed.validationMessage) { setStatus(parsed.validationMessage); return; }
    if (inFlight.current.has("add")) return;
    markPending("add", true); setStatus(""); setResults([]);
    try {
      const response = await fetch("/api/video-queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: commandKey("add"), urls: parsed.urls }) });
      const payload = await response.json() as { results?: AddVideoResult[]; queue?: VideoQueueSnapshot; error?: { message?: string } };
      if (!response.ok || !payload.results || !payload.queue) throw new Error(payload.error?.message ?? "Ajout impossible.");
      setResults(payload.results); setQueue(payload.queue);
      const accepted = payload.results.filter((result) => result.status === "accepted").length;
      setStatus(accepted ? `${accepted} vidéo${accepted > 1 ? "s" : ""} ajoutée${accepted > 1 ? "s" : ""} à la file.` : "Aucune nouvelle vidéo ajoutée. Consultez le détail ci-dessous.");
      window.setTimeout(() => resultsRef.current?.focus(), 0);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Ajout impossible. Réessayez."); }
    finally { markPending("add", false); }
  }

  async function cancel(item: VideoQueueItem) {
    if (!window.confirm(`Annuler « ${item.title ?? safeVideoLabel(item.videoId)} » ? Le vault et les connaissances existantes seront conservés.`)) return;
    await mutate(`cancel:${item.itemId}`, `/api/video-queue/items/${item.itemId}/cancel`, "Élément annulé. Les connaissances existantes sont conservées.");
  }

  return <div aria-busy={pending.size > 0} className="space-y-8">
    <section className="rounded-3xl border border-cyan-200 bg-white p-6 shadow-sm sm:p-8 dark:border-cyan-950 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-2xl font-bold">Ajouter des vidéos</h2><p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">Collez une ou plusieurs URL YouTube, une par ligne.</p></div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold dark:bg-slate-800">{parsed.lineCount} / 100 lignes</span>
      </div>
      <form onSubmit={submit} aria-busy={pending.has("add")} className="mt-6">
        <label htmlFor="video-queue-urls" className="font-bold">URLs YouTube</label>
        <textarea id="video-queue-urls" value={input} onChange={(event) => setInput(event.target.value)} rows={7} spellCheck={false} placeholder={"https://www.youtube.com/watch?v=…\nhttps://youtu.be/…"} className="mt-2 w-full rounded-2xl border border-slate-300 bg-transparent px-4 py-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:border-slate-700" />
        {parsed.validationMessage && input ? <p className="mt-2 text-sm text-rose-700 dark:text-rose-300">{parsed.validationMessage}</p> : null}
        <div className="mt-4 flex flex-wrap items-center gap-3"><button type="submit" disabled={pending.has("add") || Boolean(parsed.validationMessage)} className="rounded-xl bg-cyan-400 px-6 py-3 font-bold text-slate-950 outline-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900">{pending.has("add") ? "Ajout en cours…" : "Ajouter"}</button></div>
      </form>
    </section>

    <div role="status" aria-live="polite" className="min-h-6 text-sm font-semibold text-slate-700 dark:text-slate-200">{status}</div>

    {results.length ? <section ref={resultsRef} tabIndex={-1} aria-labelledby="queue-results-title" className="outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"><h2 id="queue-results-title" className="text-2xl font-bold">Résultat de l’ajout</h2><div className="mt-4 grid gap-4 md:grid-cols-2">{Object.entries(grouped).map(([group, entries]) => entries.length ? <div key={group} className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><h3 className="font-bold">{ADD_RESULT_TITLES[group as keyof typeof ADD_RESULT_TITLES]} · {entries.length}</h3><ul className="mt-3 space-y-2 text-sm">{entries.map((result) => { const workflowId = resultWorkflowId(result); return <li key={`${group}-${result.inputIndex}`} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950"><span>{result.videoId ? safeVideoLabel(result.videoId) : `Ligne ${result.inputIndex + 1}`}</span>{workflowId ? <Link href={`/workflows/${workflowId}`} className="ml-2 font-semibold text-cyan-700 dark:text-cyan-300">Ouvrir le traitement existant</Link> : null}</li>; })}</ul></div> : null)}</div></section> : null}

    <section aria-labelledby="queue-list-title">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 id="queue-list-title" className="text-2xl font-bold">En cours</h2><p className="mt-2 text-sm text-slate-500">Les vidéos sont traitées une à la fois, même lorsque cette page est fermée.</p></div><div className="flex flex-wrap gap-3"><button type="button" disabled={pending.has("refresh")} onClick={() => void refresh()} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold disabled:opacity-50 dark:border-slate-700">{pending.has("refresh") ? "Actualisation…" : "Actualiser l’état"}</button>{queue.paused ? <button type="button" disabled={pending.has("resume")} onClick={() => mutate("resume", "/api/video-queue/resume", "Traitement repris.")} className="rounded-xl bg-cyan-400 px-4 py-2 font-bold text-slate-950 disabled:opacity-50">{pending.has("resume") ? "Reprise…" : "Reprendre"}</button> : <button type="button" disabled={pending.has("pause")} onClick={() => mutate("pause", "/api/video-queue/pause", "Traitement mis en pause.")} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold disabled:opacity-50 dark:border-slate-700">{pending.has("pause") ? "Pause…" : "Mettre en pause"}</button>}</div></div>
      <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-2">{queue.items.length ? queue.items.map((item) => <QueueItemCard key={item.itemId} item={item} pending={pending.has(`cancel:${item.itemId}`) || pending.has(`retry:${item.itemId}`)} onCancel={() => void cancel(item)} onRetry={() => void mutate(`retry:${item.itemId}`, `/api/video-queue/items/${item.itemId}/retry`, "Nouvelle tentative lancée.")} />) : <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-500 lg:col-span-2 dark:border-slate-700"><h3 className="font-bold text-slate-700 dark:text-slate-200">Aucune vidéo en cours</h3><p className="mt-2">Ajoutez une ou plusieurs URL ci-dessus.</p></div>}</div>
    </section>
  </div>;
}
