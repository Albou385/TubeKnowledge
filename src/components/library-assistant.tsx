"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";

import type { LibraryAssistantAnswer } from "@/lib/library-assistant/assistant";
import type { AssistantHistoryRecord } from "@/lib/library-assistant/history";
import { ASSISTANT_QUESTION_MAX_LENGTH } from "@/lib/library-assistant/schema";

export function LibraryAssistant({ initialHistory }: { initialHistory: AssistantHistoryRecord[] }) {
  const [answer, setAnswer] = useState<LibraryAssistantAnswer | null>(null);
  const [history, setHistory] = useState(initialHistory);
  const [question, setQuestion] = useState("");
  const [domain, setDomain] = useState("");
  const [provider, setProvider] = useState<"extractive" | "mock">("extractive");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestInFlight = useRef(false);

  async function ask(event: FormEvent<HTMLFormElement>) {
    if (requestInFlight.current) return; requestInFlight.current = true;
    event.preventDefault(); setBusy(true); setError(""); setAnswer(null);
    try {
      const response = await fetch("/api/library-assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, domain: domain || undefined, limit: 6, provider }) });
      const payload = await response.json() as { answer?: LibraryAssistantAnswer; history?: AssistantHistoryRecord; error?: { message?: string } };
      if (!response.ok || !payload.answer) throw new Error(payload.error?.message ?? "Question impossible.");
      setAnswer(payload.answer); if (payload.history) setHistory((current) => [payload.history!, ...current]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Question impossible."); }
    finally { requestInFlight.current = false; setBusy(false); }
  }

  async function exportContext() {
    if (requestInFlight.current) return; requestInFlight.current = true;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/library-assistant/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, domain: domain || undefined, limit: 6, provider: "extractive" }) });
      if (!response.ok) throw new Error("Export impossible.");
      const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "tubeknowledge-context-codex.zip"; anchor.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Export impossible."); }
    finally { requestInFlight.current = false; setBusy(false); }
  }

  async function removeHistory(id: string) {
    const response = await fetch(`/api/library-assistant/${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmed: true }) });
    if (response.ok) setHistory((current) => current.filter((item) => item.historyId !== id));
  }

  return <div className="space-y-8">
    <form onSubmit={ask} aria-busy={busy} className="rounded-3xl border border-violet-200 bg-white p-6 sm:p-8 dark:border-violet-950 dark:bg-slate-900"><label htmlFor="library-question" className="text-lg font-bold">Votre question</label><textarea id="library-question" required maxLength={ASSISTANT_QUESTION_MAX_LENGTH} value={question} onChange={(event) => setQuestion(event.target.value)} rows={4} placeholder="Qu’est-ce que ma bibliothèque contient sur les agents IA?" className="mt-3 block w-full rounded-xl border border-slate-300 bg-transparent p-4 dark:border-slate-700" /><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">Domaine facultatif<input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="Intelligence artificielle" className="mt-2 block w-full rounded-lg border border-slate-300 bg-transparent p-3 dark:border-slate-700" /></label><label className="text-sm font-semibold">Mode<select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"><option value="extractive">Synthèse extractive sûre</option><option value="mock">Démonstration mock locale</option></select></label></div><div className="mt-5 flex flex-wrap gap-3"><button disabled={busy} className="rounded-xl bg-violet-500 px-5 py-3 font-bold text-white disabled:opacity-50">{busy ? "Recherche…" : "Interroger la bibliothèque"}</button><button type="button" disabled={busy || !question.trim()} onClick={exportContext} className="rounded-xl border border-violet-400 px-5 py-3 font-semibold text-violet-800 disabled:opacity-50 dark:text-violet-200">Préparer un contexte pour Codex</button></div><p className="mt-3 text-xs text-slate-500">Aucun appel réseau automatique. La bibliothèque n’est jamais modifiée.</p></form>
    {error ? <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-900 dark:bg-rose-950/30 dark:text-rose-100">{error}</p> : null}
    {answer ? <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-bold">Réponse fondée sur les sources</h2>{answer.fixture ? <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">Fixture locale</span> : null}</div><p className="mt-4 leading-7">{answer.answer}</p>{answer.uncertainty ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">{answer.uncertainty}</p> : null}<div className="mt-6 space-y-4">{answer.citations.map((citation) => <article key={citation.citationId} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><div className="flex flex-wrap justify-between gap-2"><strong>[{citation.citationId}] {citation.title}</strong><span className="text-xs text-slate-500">ligne {citation.lineStart}</span></div><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{citation.excerpt}</p><Link href={`/library/${citation.relativePath.split("/").map(encodeURIComponent).join("/")}${citation.anchor ? `#${citation.anchor}` : ""}`} className="mt-3 inline-block text-sm font-semibold text-cyan-700 dark:text-cyan-300">{citation.relativePath}{citation.heading ? ` · ${citation.heading}` : ""} →</Link></article>)}</div></section> : null}
    <section><h2 className="text-xl font-bold">Questions récentes</h2><div className="mt-3 space-y-2">{history.slice(0, 8).map((item) => <div key={item.historyId} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div><p className="font-semibold">{item.question}</p><p className="text-xs text-slate-500">{item.references.length} source(s) · {new Date(item.createdAt).toLocaleString("fr-CA")}</p></div><button type="button" onClick={() => removeHistory(item.historyId)} className="text-sm font-semibold text-rose-700 dark:text-rose-300">Supprimer</button></div>)}{!history.length ? <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500 dark:border-slate-700">Aucune question enregistrée.</p> : null}</div></section>
  </div>;
}
