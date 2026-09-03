"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { AcquisitionJob } from "@/lib/transcription/types";
import { recommendedSubtitleTrack, sameSubtitleTrack, visibleWorkflowSubtitleTracks } from "@/lib/transcription/subtitle-tracks";
import type { VideoKnowledgeWorkflow } from "@/lib/workflows/schema";

import { STATE_LABELS } from "./workflow-starter";

const ACTIVE = new Set(["acquiring"]);
const SOURCE_LABELS: Record<string, string> = { "manual-subtitles": "sous-titres manuels", "automatic-subtitles": "sous-titres automatiques", "local-whisper": "transcription locale Whisper", "uploaded-transcript": "transcript importé" };

export function WorkflowDetail({ initialWorkflow, initialJob }: { initialWorkflow: VideoKnowledgeWorkflow; initialJob: AcquisitionJob | null }) {
  const router = useRouter();
  const [workflow, setWorkflow] = useState(initialWorkflow);
  const [job, setJob] = useState(initialJob);
  const [selected, setSelected] = useState(() => initialJob?.inspection ? recommendedSubtitleTrack(initialJob.inspection.subtitles) : undefined);
  const [allLanguages, setAllLanguages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const requestInFlight = useRef(false);
  const visibleTracks = useMemo(() => visibleWorkflowSubtitleTracks(job?.inspection?.subtitles ?? [], allLanguages), [allLanguages, job]);
  const selectedTrack = visibleTracks.find((track) => sameSubtitleTrack(track, selected)) ?? recommendedSubtitleTrack(job?.inspection?.subtitles ?? []);

  useEffect(() => {
    if (!ACTIVE.has(workflow.state)) return;
    let polls = 0;
    const timer = window.setInterval(async () => {
      if (polls++ >= 1200) { window.clearInterval(timer); setError("Le suivi automatique a été arrêté après une heure. Actualisez pour reprendre."); return; }
      try {
        const response = await fetch(`/api/workflows/${workflow.workflowId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "sync" }) });
        const payload = await response.json() as { workflow?: VideoKnowledgeWorkflow };
        if (payload.workflow) {
          setWorkflow(payload.workflow);
          if (payload.workflow.acquisitionId) {
            const jobResponse = await fetch(`/api/acquisitions/${payload.workflow.acquisitionId}`, { cache: "no-store" });
            const jobPayload = await jobResponse.json() as { job?: AcquisitionJob };
            if (jobPayload.job) setJob(jobPayload.job);
          }
        }
      } catch { /* La prochaine observation réessaiera. */ }
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [workflow.state, workflow.workflowId]);

  useEffect(() => {
    if (workflow.state !== "transcript-ready" || !workflow.acquisitionId) return;
    void fetch(`/api/acquisitions/${workflow.acquisitionId}/artifacts/transcript.txt`).then((response) => response.ok ? response.text() : "").then((text) => setPreview(text.slice(0, 8_000)));
  }, [workflow.acquisitionId, workflow.state]);

  async function start(source: unknown) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/workflows/${workflow.workflowId}/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source }) });
      const payload = await response.json() as { workflow?: VideoKnowledgeWorkflow; error?: { message?: string } };
      if (!response.ok || !payload.workflow) throw new Error(payload.error?.message ?? "Démarrage impossible.");
      setWorkflow(payload.workflow);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Démarrage impossible."); }
    finally { requestInFlight.current = false; setBusy(false); }
  }

  async function resume() {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true); setError("");
    try {
      const inspect = workflow.state === "draft" || workflow.state === "inspecting" || (workflow.state === "failed" && !workflow.acquisitionId);
      const response = await fetch(inspect ? `/api/workflows/${workflow.workflowId}/inspect` : `/api/workflows/${workflow.workflowId}`, { method: inspect ? "POST" : "PATCH", headers: inspect ? undefined : { "content-type": "application/json" }, body: inspect ? undefined : JSON.stringify({ action: "resume" }) });
      const payload = await response.json() as { workflow?: VideoKnowledgeWorkflow; error?: { message?: string } };
      if (!response.ok || !payload.workflow) throw new Error(payload.error?.message ?? "Reprise impossible.");
      setWorkflow(payload.workflow); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Reprise impossible."); }
    finally { requestInFlight.current = false; setBusy(false); }
  }

  async function remove() {
    if (!window.confirm("Supprimer ce traitement de la liste ? Les acquisitions, paquets, imports, backups et connaissances seront conservés.")) return;
    const response = await fetch(`/api/workflows/${workflow.workflowId}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmed: true }) });
    if (response.ok) { router.push("/workflows"); router.refresh(); }
    else setError("Suppression du traitement impossible.");
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><Link href="/workflows" className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">← Traitements récents</Link><p className="mt-5 text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase dark:text-cyan-300">Vidéo → Connaissance</p><h1 className="mt-2 text-3xl font-bold">{workflow.title ?? "Nouvelle vidéo"}</h1><p className="mt-2 text-slate-500">{workflow.nextAction}</p></div>
      <span className="rounded-full bg-cyan-50 px-4 py-2 text-sm font-bold text-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-100">{STATE_LABELS[workflow.state]}</span>
    </div>

    <ol className="grid gap-2 text-xs sm:grid-cols-4"><li className="rounded-xl bg-cyan-100 p-3 text-cyan-950 dark:bg-cyan-950 dark:text-cyan-100">1. Transcription</li><li className="rounded-xl bg-violet-100 p-3 text-violet-950 dark:bg-violet-950 dark:text-violet-100">2. Analyse</li><li className="rounded-xl bg-amber-100 p-3 text-amber-950 dark:bg-amber-950 dark:text-amber-100">3. Vérification</li><li className="rounded-xl bg-emerald-100 p-3 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100">4. Bibliothèque</li></ol>

    {["draft", "inspecting"].includes(workflow.state) ? <section className="rounded-2xl border border-cyan-200 bg-white p-6 dark:border-cyan-950 dark:bg-slate-900"><h2 className="text-2xl font-bold">Inspecter la vidéo</h2><p className="mt-2 text-slate-500">L’inspection ne télécharge ni vidéo ni modèle. Si une interruption a eu lieu, vous pouvez la relancer ici.</p><button type="button" disabled={busy} onClick={resume} className="mt-5 rounded-xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 disabled:opacity-50">{busy ? "Inspection…" : workflow.state === "inspecting" ? "Relancer l’inspection" : "Inspecter la vidéo"}</button></section> : null}

    {job?.inspection && workflow.state === "source-selection" ? <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div><p className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">Inspection réussie · {Math.round(job.inspection.durationSeconds / 60)} min · {job.inspection.language ?? "langue à détecter"}</p><h2 className="mt-1 text-2xl font-bold">Choisir la transcription</h2><p className="mt-2 text-sm text-slate-500">La meilleure piste visible est présélectionnée : sous-titres manuels, puis automatiques, puis Whisper local.</p></div>
      {visibleTracks.map((track) => <label key={`${track.origin}-${track.language}`} className="flex gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700"><input type="radio" checked={sameSubtitleTrack(selectedTrack, track)} onChange={() => setSelected(track)} /><span><strong>{track.origin === "manual" ? "Sous-titres manuels" : "Sous-titres automatiques"} · {track.language}</strong><small className="block text-slate-500">{track.formats.map((format) => format.extension.toUpperCase()).join(", ")}</small></span></label>)}
      <button type="button" onClick={() => setAllLanguages((current) => !current)} className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">{allLanguages ? "Masquer les autres langues" : "Afficher toutes les langues"}</button>
      <div className="flex flex-wrap gap-3"><button type="button" disabled={busy || !selectedTrack} onClick={() => selectedTrack && start({ kind: "subtitles", language: selectedTrack.language, origin: selectedTrack.origin, format: selectedTrack.formats[0].extension })} className="rounded-xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 disabled:opacity-50">Utiliser la piste sélectionnée</button><details className="rounded-xl border border-slate-300 p-3 dark:border-slate-700"><summary className="cursor-pointer font-semibold">Option avancée Whisper</summary><p className="mt-2 max-w-xl text-sm text-slate-500">Whisper exige une confirmation explicite avant tout téléchargement éventuel de modèle. Les réglages complets restent disponibles dans l’écran Acquisition avancé.</p><Link href="/acquisitions/new" className="mt-2 inline-block text-sm font-semibold text-violet-700 dark:text-violet-300">Ouvrir les options avancées →</Link></details></div>
    </section> : null}

    {workflow.state === "acquiring" && job ? <section aria-busy="true" className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><div className="flex justify-between gap-4"><h2 className="text-xl font-bold">Transcription en cours</h2><span>{job.progress === null ? "Étape en cours" : `${Math.round(job.progress * 100)} %`}</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"><div className="h-full bg-cyan-400 transition-all" style={{ width: job.progress === null ? "8%" : `${job.progress * 100}%` }} /></div><p className="mt-4">{job.message}</p><details className="mt-4"><summary className="cursor-pointer text-sm font-semibold text-slate-500">Détails techniques</summary><p className="mt-2 text-sm text-slate-500">Étape : {job.stage} · source : {job.sourceKind}</p></details><Link href={`/acquisitions/${job.id}`} className="mt-4 inline-block text-sm font-semibold text-cyan-700 dark:text-cyan-300">Gérer ou annuler →</Link></section> : null}

    {workflow.state === "transcript-ready" ? <section className="rounded-2xl border border-emerald-200 bg-white p-6 dark:border-emerald-950 dark:bg-slate-900"><p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Transcript prêt{job?.sourceKind ? ` · ${SOURCE_LABELS[job.sourceKind] ?? "source locale"}` : ""}</p><h2 className="mt-2 text-2xl font-bold">Préparer l’analyse</h2>{preview ? <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-950">{preview}{preview.length >= 8_000 ? "\n… aperçu tronqué …" : ""}</pre> : null}<Link href={`/chatgpt-packages/new?acquisitionId=${workflow.acquisitionId}&workflowId=${workflow.workflowId}`} className="mt-5 inline-flex rounded-xl bg-violet-500 px-5 py-3 font-bold text-white">Préparer l’analyse</Link></section> : null}

    {["analysis-preparing", "analysis-ready", "awaiting-result", "result-received"].includes(workflow.state) ? <section className="rounded-2xl border border-violet-200 bg-white p-6 dark:border-violet-950 dark:bg-slate-900"><h2 className="text-2xl font-bold">Analyse</h2><p className="mt-2 text-slate-500">Le mode manuel reste le mode par défaut. Suivez les trois étapes du paquet d’analyse; le ZIP envoyé et le ZIP retourné sont deux fichiers différents.</p>{workflow.packageId ? <Link href={`/chatgpt-packages/${workflow.packageId}`} className="mt-5 inline-flex rounded-xl bg-violet-500 px-4 py-3 font-semibold text-white">Continuer l’analyse manuelle</Link> : <Link href={`/chatgpt-packages/new?acquisitionId=${workflow.acquisitionId}&workflowId=${workflow.workflowId}`} className="mt-5 inline-flex rounded-xl bg-violet-500 px-5 py-3 font-bold text-white">Reprendre la préparation</Link>}</section> : null}

    {["preview-ready", "blocked-reader", "blocked-conflict"].includes(workflow.state) && workflow.packageId ? <section className="rounded-2xl border border-amber-200 bg-white p-6 dark:border-amber-950 dark:bg-slate-900"><h2 className="text-2xl font-bold">Vérifier les changements</h2><p className="mt-2">{workflow.state === "blocked-reader" ? "Les changements sont prêts, mais cette machine n’a pas actuellement l’autorisation d’écrire dans la bibliothèque." : workflow.state === "blocked-conflict" ? "Un conflit doit être résolu avant l’ajout." : "Le résumé et les différences sont prêts. Aucune écriture n’a encore eu lieu."}</p><div className="mt-5 flex flex-wrap gap-3"><Link href={`/chatgpt-packages/${workflow.packageId}/result`} className="inline-flex rounded-xl bg-amber-400 px-5 py-3 font-bold text-slate-950">Ouvrir la vérification</Link>{workflow.state === "blocked-reader" ? <Link href="/portability" className="inline-flex rounded-xl border border-amber-400 px-5 py-3 font-semibold text-amber-800 dark:text-amber-200">Gérer l’autorisation d’écriture</Link> : null}</div></section> : null}

    {workflow.state === "imported" ? <section className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6 dark:border-emerald-900 dark:bg-emerald-950/20"><p className="font-semibold text-emerald-800 dark:text-emerald-200">Ajout réussi avec sauvegarde et historique.</p><h2 className="mt-2 text-2xl font-bold">Connaissances ajoutées</h2><div className="mt-4 flex max-w-full flex-wrap gap-3">{workflow.knowledgePaths.map((relativePath) => <Link key={relativePath} title={relativePath} href={`/library/${relativePath.split("/").map(encodeURIComponent).join("/")}`} className="max-w-full break-all rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white"><span className="sm:hidden">{relativePath.split("/").at(-1)}</span><span className="hidden sm:inline">{relativePath}</span></Link>)}</div><div className="mt-5 flex flex-wrap gap-4"><Link href="/ask" className="font-semibold text-violet-700 dark:text-violet-300">Poser une question →</Link><Link href="/add-video" className="font-semibold text-cyan-700 dark:text-cyan-300">Ajouter une autre vidéo →</Link></div></section> : null}

    {workflow.state === "failed" ? <section role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-5 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100"><h2 className="font-bold">Le traitement a été interrompu</h2><p className="mt-2 text-sm">Vous pouvez reprendre depuis la dernière étape conservée. Les artefacts déjà produits ne sont pas supprimés.</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={resume} className="rounded-lg bg-rose-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? "Reprise…" : "Reprendre"}</button>{workflow.acquisitionId ? <Link href={`/acquisitions/${workflow.acquisitionId}`} className="rounded-lg border border-rose-400 px-4 py-2 font-semibold">Voir la transcription</Link> : null}</div>{workflow.lastErrorCode ? <details className="mt-4 text-xs"><summary className="cursor-pointer font-semibold">Détail technique</summary><code>{workflow.lastErrorCode}</code></details> : null}</section> : null}
    {workflow.state === "canceled" ? <section className="rounded-xl border border-slate-300 bg-white p-5 dark:border-slate-700 dark:bg-slate-900"><h2 className="font-bold">Traitement annulé</h2><Link href="/add-video" className="mt-4 inline-flex rounded-lg bg-cyan-400 px-4 py-2 font-semibold text-slate-950">Créer un nouveau traitement</Link></section> : null}
    {error ? <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-900 dark:bg-rose-950/30 dark:text-rose-100">{error}</p> : null}
    <details className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"><summary className="cursor-pointer font-semibold text-slate-500">Actions avancées</summary><button type="button" onClick={remove} className="mt-3 rounded-lg border border-rose-400 px-3 py-2 text-sm font-semibold text-rose-700 dark:text-rose-300">Retirer de la liste uniquement</button><p className="mt-2 text-xs text-slate-500">Cette action conserve toutes les acquisitions, connaissances, sauvegardes et traces d’import.</p></details>
  </div>;
}
