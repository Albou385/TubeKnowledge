"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { AcquisitionJob } from "@/lib/transcription/types";
import { clientErrorMessage } from "@/lib/transcription/client-errors";
import { PUBLIC_TRANSCRIPTION_ERRORS, isPublicTranscriptionErrorCode, type PublicTranscriptionErrorPayload } from "@/lib/transcription/error-catalog";

const TERMINAL = new Set(["completed", "failed", "canceled", "interrupted", "waiting-for-selection"]);

export function AcquisitionDetail({ initialJob }: { initialJob: AcquisitionJob }) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (TERMINAL.has(job.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/acquisitions/${job.id}`, { cache: "no-store" });
        const payload = await response.json() as { job?: AcquisitionJob };
        if (payload.job) setJob(payload.job);
      } catch { /* Le prochain polling réessaiera. */ }
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [job.id, job.status]);

  useEffect(() => {
    if (job.status !== "completed" || !job.artifacts.some((artifact) => artifact.name === "transcript.txt")) return;
    void fetch(`/api/acquisitions/${job.id}/artifacts/transcript.txt`).then((response) => response.ok ? response.text() : "").then((text) => setPreview(text.slice(0, 8_000)));
  }, [job.id, job.status, job.artifacts]);

  async function cancel() {
    setError("");
    const response = await fetch(`/api/acquisitions/${job.id}/cancel`, { method: "POST" });
    const payload = await response.json() as { job?: AcquisitionJob; error?: PublicTranscriptionErrorPayload };
    if (payload.job) setJob(payload.job); else setError(clientErrorMessage(payload.error, "Annulation impossible."));
  }
  async function remove() {
    if (!window.confirm("Supprimer définitivement cette acquisition et ses artifacts hors vault ?")) return;
    const response = await fetch(`/api/acquisitions/${job.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmed: true }) });
    if (response.ok) { router.push("/acquisitions"); router.refresh(); return; }
    const payload = await response.json() as { error?: PublicTranscriptionErrorPayload }; setError(clientErrorMessage(payload.error, "Suppression impossible."));
  }

  const canCancel = !TERMINAL.has(job.status) && job.status !== "canceling";
  const canDelete = ["completed", "failed", "canceled", "interrupted"].includes(job.status);
  const jobErrorCode = job.error && isPublicTranscriptionErrorCode(job.error.code) ? job.error.code : "WORKER_FAILED";
  const jobErrorMessage = job.error ? clientErrorMessage(job.error, PUBLIC_TRANSCRIPTION_ERRORS.WORKER_FAILED) : "";
  return <div className="space-y-6">
    <div><Link href="/acquisitions" className="text-sm text-cyan-700 dark:text-cyan-300">← Acquisitions</Link><p className="mt-5 text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase dark:text-cyan-300">{job.sourceKind || "Acquisition"}</p><h1 className="mt-2 text-3xl font-bold">{job.title || "Traitement en cours"}</h1><p className="mt-2 text-sm text-slate-500">Job {job.id}</p></div>
    <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between"><strong>{job.status}</strong><span className="text-sm text-slate-500">{job.progress === null ? "Progression indéterminée" : `${Math.round(job.progress * 100)} %`}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"><div className="h-full bg-cyan-400 transition-all" style={{ width: job.progress === null ? "0%" : `${job.progress * 100}%` }} /></div><p className="mt-3 text-sm">{job.message}</p><p className="mt-1 text-xs text-slate-500">Étape : {job.stage}</p></section>
    {job.warnings.length ? <section><h2 className="font-semibold">Avertissements</h2><div className="mt-2 space-y-2">{job.warnings.map((warning, index) => <p key={`${warning.code}-${index}`} className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><strong>{warning.code}</strong> · {warning.message}</p>)}</div></section> : null}
    {job.error ? <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"><strong>{jobErrorCode}</strong> · {jobErrorMessage}</p> : null}
    {job.artifacts.length ? <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><h2 className="text-xl font-semibold">Artifacts</h2><div className="mt-4 flex flex-wrap gap-2">{job.artifacts.map((artifact) => <a key={artifact.name} href={`/api/acquisitions/${job.id}/artifacts/${artifact.name}`} className="rounded-lg border border-cyan-300 px-3 py-2 text-sm text-cyan-800 dark:border-cyan-800 dark:text-cyan-300">Télécharger {artifact.name}</a>)}</div></section> : null}
    {preview ? <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><h2 className="text-xl font-semibold">Aperçu du transcript</h2><pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{preview}{preview.length >= 8_000 ? "\n… aperçu tronqué …" : ""}</pre></section> : null}
    {error ? <p role="alert" className="text-rose-700 dark:text-rose-300">{error}</p> : null}<div className="flex flex-wrap gap-3">{job.status === "completed" ? <Link href={`/chatgpt-packages/new?acquisitionId=${job.id}`} className="rounded-xl bg-violet-500 px-4 py-2 font-semibold text-white">Préparer pour ChatGPT</Link> : null}{canCancel ? <button type="button" onClick={cancel} className="rounded-xl bg-amber-400 px-4 py-2 font-semibold text-slate-950">Annuler le traitement</button> : null}{canDelete ? <button type="button" onClick={remove} className="rounded-xl border border-rose-400 px-4 py-2 font-semibold text-rose-700 dark:text-rose-300">Supprimer l’acquisition</button> : null}</div>
  </div>;
}
