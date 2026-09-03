"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";

import type { ImportPreview } from "@/lib/imports/types";
import type { ApplyResult } from "@/lib/imports/apply";

const RESULT_LABELS: Record<ApplyResult["status"], string> = {
  success: "Ajout réussi", rejected: "Ajout refusé", conflict: "Conflit détecté", "rolled-back": "Échec restauré sans changement", "rollback-failed": "Restauration incomplète",
};

export function ImportWorkbench({ initialPreview = null, hideUpload = false, onApplied, onSessionInvalid }: { initialPreview?: ImportPreview | null; hideUpload?: boolean; onApplied?: (result: ApplyResult) => void | Promise<void>; onSessionInvalid?: (issue: { message: string; action?: string }) => void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(initialPreview?.appliedResult ? null : initialPreview);
  const [result, setResult] = useState<ApplyResult | null>(initialPreview?.appliedResult ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const requestInFlight = useRef(false);

  async function previewPackage(event: FormEvent<HTMLFormElement>) {
    if (requestInFlight.current) return; requestInFlight.current = true;
    event.preventDefault(); setBusy(true); setError(""); setResult(null); setPreview(null); setConfirmed(false); setConfirmationText("");
    try {
      const response = await fetch("/api/imports/preview", { method: "POST", body: new FormData(event.currentTarget) });
      const payload = await response.json() as { preview?: ImportPreview; error?: string | { message?: string; action?: string } };
      if (!response.ok || !payload.preview) {
        const failure = typeof payload.error === "string" ? payload.error : [payload.error?.message, payload.error?.action].filter(Boolean).join(" ");
        throw new Error(failure || "Prévisualisation impossible.");
      }
      setPreview(payload.preview);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Prévisualisation impossible."); }
    finally { requestInFlight.current = false; setBusy(false); }
  }

  async function applyPackage() {
    if (!preview || requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/imports/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: preview.sessionId, confirmed, confirmationText }) });
      const payload = await response.json() as { result?: ApplyResult; error?: string | { message?: string; action?: string } };
      if (!payload.result) {
        const failure = typeof payload.error === "string" ? payload.error : [payload.error?.message, payload.error?.action].filter(Boolean).join(" ");
        if ((response.status === 404 || response.status === 410) && typeof payload.error !== "string") {
          setPreview(null);
          onSessionInvalid?.({ message: payload.error && typeof payload.error !== "string" ? payload.error.message ?? "Cette vérification n’est plus disponible." : "Cette vérification n’est plus disponible.", action: payload.error && typeof payload.error !== "string" ? payload.error.action : undefined });
        }
        throw new Error(failure || "Application impossible.");
      }
      setResult(payload.result);
      try { await onApplied?.(payload.result); }
      catch { setError("L’ajout est terminé, mais la liste des traitements n’a pas pu être actualisée. La connaissance et l’historique sont conservés."); }
      if (payload.result.status === "success") setPreview(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Application impossible."); }
    finally { requestInFlight.current = false; setBusy(false); }
  }

  const strongConfirmation = preview?.structuralChange.level === "major" || preview?.structuralChange.confirmationRequired;

  return (
    <div className="space-y-6">
      {!hideUpload ? <form onSubmit={previewPackage} className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
        <label htmlFor="import-package" className="block text-lg font-semibold">Sélectionner un paquet ZIP</label>
        <p className="mt-2 text-sm text-slate-500">10 MiB · 100 entrées · 50 opérations · 1 MiB par Markdown · 10 MiB décompressés</p>
        <input id="import-package" name="package" type="file" accept=".zip,application/zip" required className="mt-5 block w-full rounded-lg border border-slate-300 p-3 dark:border-slate-700" />
        <button disabled={busy} className="mt-4 rounded-xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 disabled:opacity-50">{busy ? "Validation…" : "Prévisualiser sans appliquer"}</button>
      </form> : null}

      {error ? <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</p> : null}
      {result ? <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><h2 className="text-xl font-semibold">{RESULT_LABELS[result.status]}</h2><p className="mt-2">{result.message}</p>{result.idempotent ? <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">Le résultat déjà appliqué a été relu; aucune nouvelle écriture ni sauvegarde n’a été créée.</p> : null}{result.failure ? <div className="mt-4 rounded-xl bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><p>{result.failure.action}</p>{result.failure.code.includes("WRITER") ? <Link href="/portability/setup" className="mt-2 inline-block font-semibold underline">Gérer writer →</Link> : null}{result.failure.retryable ? <p className="mt-2 text-sm">Cette session reste réutilisable.</p> : <><p className="mt-2 text-sm">Une nouvelle Preview est requise.</p>{onSessionInvalid ? <button type="button" onClick={() => { setPreview(null); setResult(null); onSessionInvalid({ message: result.failure!.message, action: result.failure!.action }); }} className="mt-3 rounded-lg border border-amber-700 px-3 py-2 font-semibold">Recréer la Preview</button> : null}</>}</div> : null}{result.status === "success" ? <div className="mt-5 flex flex-wrap gap-4"><Link href="/" className="font-semibold text-emerald-700 dark:text-emerald-300">Retrouver les connaissances →</Link><Link href="/ask" className="font-semibold text-violet-700 dark:text-violet-300">Poser une question →</Link></div> : null}<details className="mt-4 text-xs text-slate-500"><summary className="cursor-pointer font-semibold">Détails techniques et historique</summary><p className="mt-2">Code : {result.failure?.code ?? "APPLIED"}. Statut : {result.status}. Sauvegarde : {result.backupId ?? "aucune"}.</p><Link href="/imports/history" className="mt-2 inline-block text-cyan-600 dark:text-cyan-300">Consulter l’historique →</Link></details></section> : null}

      {preview ? (
        <section className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-2xl font-bold">{preview.source.title}</h2><p className="mt-2">{preview.summary}</p>{preview.structuralChange.level !== "none" ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">Ce paquet propose aussi un changement de structure : {preview.structuralChange.summary}</p> : null}<details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer font-semibold">Origine et structure techniques</summary><p className="mt-2">Origine : {preview.source.type}. Niveau structurel : {preview.structuralChange.level}.</p></details>
          </div>
          <details className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><summary className="cursor-pointer font-semibold">Notes de revue</summary><pre className="mt-4 overflow-auto whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{preview.review}</pre></details>
          {preview.operations.map((operation) => <article key={operation.path} className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><header className="p-4"><div><strong>{operation.type === "create" ? "Créer" : "Mettre à jour"}</strong> <code className="break-all">{operation.path}</code><p className="mt-1 text-sm text-slate-500">{operation.message}</p></div><details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer font-semibold">Hashes de vérification</summary><p className="mt-1 break-all">{operation.beforeSha256 ?? "absent"} → {operation.afterSha256}</p></details></header><pre className="max-h-96 overflow-auto border-t border-slate-200 bg-slate-950 p-4 text-xs text-slate-200 dark:border-slate-800">{operation.diff.lines.map((line, index) => <span key={index} className={`block ${line.type === "add" ? "text-emerald-300" : line.type === "remove" ? "text-rose-300" : "text-slate-400"}`}>{line.type === "add" ? "+" : line.type === "remove" ? "-" : " "} {line.value || " "}</span>)}{operation.diff.truncated ? <span className="block text-amber-300">… aperçu tronqué …</span> : null}</pre></article>)}
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 dark:border-amber-900 dark:bg-amber-950/20"><label className="flex gap-3"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Je confirme l’ajout de tous les changements présentés ci-dessus.</label>{strongConfirmation ? <label className="mt-4 block">Pour ce changement de structure, saisissez exactement <strong>APPLIQUER</strong><input value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} className="mt-2 block w-full rounded-lg border border-amber-400 bg-white p-2 text-slate-950" /></label> : null}<button type="button" onClick={applyPackage} disabled={busy || !preview.canApply || !confirmed || Boolean(strongConfirmation && confirmationText !== "APPLIQUER")} className="mt-5 rounded-xl bg-amber-500 px-5 py-3 font-bold text-slate-950 disabled:opacity-40">{result?.failure?.retryable || preview.failure?.retryable ? "Réessayer l’ajout" : "Ajouter avec sauvegarde"}</button>{!preview.canApply ? <p className="mt-3 text-sm text-rose-700 dark:text-rose-300">{preview.failure?.action ?? "Les conflits ou éléments invalides exigent une nouvelle Preview."}</p> : null}</div>
        </section>
      ) : null}
    </div>
  );
}
