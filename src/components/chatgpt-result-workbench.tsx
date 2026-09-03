"use client";

import { FormEvent, useRef, useState } from "react";

import { ImportWorkbench } from "@/components/import-workbench";
import type { ImportPreview } from "@/lib/imports/types";

export function ChatGptResultWorkbench({ packageId, workflowId, initialPreview = null, initialSessionIssue = null }: { packageId: string; workflowId?: string; initialPreview?: ImportPreview | null; initialSessionIssue?: { code: string; message: string; action: string } | null }) {
  const [preview, setPreview] = useState<ImportPreview | null>(initialPreview);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<{ message: string; technicalDetail?: string } | null>(initialSessionIssue ? { message: `${initialSessionIssue.message} ${initialSessionIssue.action}` } : null);
  const [busy, setBusy] = useState(false);
  const requestInFlight = useRef(false);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlight.current) return; requestInFlight.current = true;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/chatgpt-packages/${packageId}/result`, { method: "POST", body: new FormData(event.currentTarget) });
      const payload = await response.json() as { result?: { preview: ImportPreview; warnings: string[] }; error?: string | { message?: string; technicalDetail?: string } };
      if (!response.ok || !payload.result) {
        const failure = typeof payload.error === "string" ? { message: payload.error } : { message: payload.error?.message ?? "Vérification impossible.", technicalDetail: payload.error?.technicalDetail };
        setError(failure); return;
      }
      setWarnings(payload.result.warnings); setPreview(payload.result.preview); setError(null);
      if (workflowId) await fetch(`/api/workflows/${workflowId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "attach-preview", previewSessionId: payload.result.preview.sessionId, canApply: payload.result.preview.canApply }) });
    } catch (cause) { setError({ message: cause instanceof Error ? cause.message : "Vérification impossible." }); } finally { requestInFlight.current = false; setBusy(false); }
  }
  return <div className="space-y-6">
    {!preview ? <form onSubmit={upload} aria-busy={busy} className="rounded-2xl border border-dashed border-violet-300 p-6 dark:border-violet-800"><label htmlFor="chatgpt-result" className="text-lg font-bold">Importer le ZIP retourné</label><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Choisissez le ZIP créé après l’analyse. Ne remettez pas ici le paquet que vous avez envoyé à ChatGPT.</p><input id="chatgpt-result" name="result" type="file" accept=".zip,application/zip" required className="mt-4 block w-full rounded-lg border border-slate-300 p-3 dark:border-slate-700" /><button disabled={busy} className="mt-4 rounded-xl bg-violet-500 px-5 py-3 font-bold text-white disabled:opacity-50">{busy ? "Vérification…" : "Importer le ZIP retourné"}</button></form> : null}
    {warnings.map((warning) => <p key={warning} className="rounded-lg bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{warning}</p>)}
    {error ? <div role="alert" className="rounded-lg bg-rose-50 p-4 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200"><p className="font-semibold">{error.message}</p>{error.technicalDetail ? <details className="mt-3 text-xs"><summary className="cursor-pointer font-semibold">Détails techniques</summary><p className="mt-2">{error.technicalDetail}</p></details> : null}<p className="mt-3 text-sm">Vous pouvez sélectionner immédiatement un autre fichier.</p></div> : null}
    {preview ? <><div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"><strong>Résultat prêt à vérifier.</strong> Aucune écriture n’a encore eu lieu. Cette vérification reste disponible après un rafraîchissement tant qu’elle n’a pas expiré.</div><ImportWorkbench initialPreview={preview} hideUpload onSessionInvalid={(issue) => { setPreview(null); setError({ message: [issue.message, issue.action].filter(Boolean).join(" ") }); }} onApplied={async (result) => { if (workflowId && result.status === "success") { const response = await fetch(`/api/workflows/${workflowId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "imported", importId: result.importId }) }); if (!response.ok) throw new Error("Le traitement récent n’a pas pu être actualisé."); } }} /></> : null}
  </div>;
}
