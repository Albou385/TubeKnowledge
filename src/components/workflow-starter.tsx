"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { VideoKnowledgeWorkflow } from "@/lib/workflows/schema";

const STATE_LABELS: Record<VideoKnowledgeWorkflow["state"], string> = {
  draft: "À inspecter", inspecting: "Inspection", "source-selection": "Choisir la transcription", acquiring: "Transcription en cours",
  "transcript-ready": "Transcript prêt", "analysis-preparing": "Préparation", "analysis-ready": "Analyse prête", "awaiting-result": "Résultat attendu",
  "result-received": "Résultat reçu", "preview-ready": "Vérification prête", "blocked-reader": "Écriture indisponible", "blocked-conflict": "Conflit à résoudre",
  imported: "Ajouté", failed: "À reprendre", canceled: "Annulé",
};

export function WorkflowStarter({ recent }: { recent: VideoKnowledgeWorkflow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [duplicateUrl, setDuplicateUrl] = useState("");
  const requestInFlight = useRef(false);

  async function create(sourceUrl: string, allowReprocess: boolean) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceUrl, allowReprocess }) });
      const payload = await response.json() as { workflow?: VideoKnowledgeWorkflow; error?: { code?: string; message?: string } };
      if (!response.ok || !payload.workflow) {
        if (payload.error?.code === "DUPLICATE_REQUIRES_CONFIRMATION") setDuplicateUrl(sourceUrl);
        throw new Error(payload.error?.message ?? "Création impossible.");
      }
      const inspection = await fetch(`/api/workflows/${payload.workflow.workflowId}/inspect`, { method: "POST" });
      if (!inspection.ok) {
        const failure = await inspection.json() as { error?: { message?: string } };
        throw new Error(failure.error?.message ?? "Inspection impossible.");
      }
      router.push(`/workflows/${payload.workflow.workflowId}`);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Création impossible."); }
    finally { requestInFlight.current = false; setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sourceUrl = new FormData(event.currentTarget).get("sourceUrl")?.toString().trim() ?? "";
    setDuplicateUrl("");
    await create(sourceUrl, false);
  }

  return <div className="space-y-8">
    <form onSubmit={submit} aria-busy={busy} className="rounded-3xl border border-cyan-200 bg-white p-6 shadow-sm sm:p-8 dark:border-cyan-950 dark:bg-slate-900">
      <label htmlFor="workflow-source-url" className="text-lg font-bold">URL de la vidéo YouTube</label>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">TubeKnowledge inspecte d’abord la vidéo et choisit la meilleure transcription disponible. Aucun téléchargement ne commence à cette étape.</p>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <input id="workflow-source-url" name="sourceUrl" type="url" required maxLength={2048} placeholder="https://www.youtube.com/watch?v=…" className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-transparent px-4 py-3 dark:border-slate-700" />
        <button disabled={busy} className="rounded-xl bg-cyan-400 px-6 py-3 font-bold text-slate-950 disabled:opacity-50">{busy ? "Inspection…" : "Continuer"}</button>
      </div>
      {error ? <div role="alert" className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100"><p>{error}</p>{duplicateUrl ? <button type="button" disabled={busy} onClick={() => create(duplicateUrl, true)} className="mt-3 rounded-lg border border-rose-400 px-3 py-2 font-semibold">Retraiter explicitement cette vidéo</button> : null}</div> : null}
    </form>

    <section aria-labelledby="recent-workflows-title">
      <div className="flex items-center justify-between"><h2 id="recent-workflows-title" className="text-xl font-bold">Traitements récents</h2><Link href="/workflows" className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">Tout voir →</Link></div>
      <div className="mt-4 grid gap-3">
        {recent.length ? recent.map((workflow) => <Link key={workflow.workflowId} href={`/workflows/${workflow.workflowId}`} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 hover:border-cyan-400 dark:border-slate-800 dark:bg-slate-900">
          <div><strong>{workflow.title ?? "Vidéo à inspecter"}</strong><p className="mt-1 text-sm text-slate-500">{workflow.nextAction} · {new Date(workflow.updatedAt).toLocaleString("fr-CA")}</p></div>
          <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-200">{STATE_LABELS[workflow.state]}</span>
        </Link>) : <p className="rounded-2xl border border-dashed border-slate-300 p-7 text-center text-slate-500 dark:border-slate-700">Aucun traitement. Ajoutez votre première vidéo.</p>}
      </div>
    </section>
  </div>;
}

export { STATE_LABELS };
