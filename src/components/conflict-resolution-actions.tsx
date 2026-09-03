"use client";

import Link from "next/link";
import { useRef, useState } from "react";

interface ResolutionResponse {
  message?: string;
  error?: { message?: string };
}

export function ConflictResolutionActions({ conflictId }: { conflictId: string }) {
  const [busy, setBusy] = useState<"keep-current" | "false-positive" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(action: "keep-current" | "false-positive") {
    const confirmation = action === "keep-current"
      ? "Conserver explicitement le contenu actuellement affiché ? Le fichier ne sera pas modifié."
      : "Classer explicitement ce conflit comme faux positif ? Le fichier ne sera pas modifié.";
    if (!window.confirm(confirmation)) return;
    setBusy(action); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/portability/conflicts/${encodeURIComponent(conflictId)}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, confirmed: true }),
      });
      const payload = await response.json() as ResolutionResponse;
      if (!response.ok) throw new Error(payload.error?.message || "La résolution n’a pas abouti.");
      setMessage(payload.message || "Le conflit est résolu.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "La résolution n’a pas abouti.");
    } finally { setBusy(null); }
  }

  if (message) return <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950" role="status"><p className="font-semibold">{message}</p><p className="mt-1 text-sm">La baseline locale a été rafraîchie sans Apply Phase 3.</p><Link className="mt-3 inline-flex rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white" href="/portability">Retour à Portabilité</Link></div>;

  return <section className="space-y-4 rounded-2xl border border-cyan-300 p-5" aria-labelledby="resolution-title"><div><h2 id="resolution-title" className="text-xl font-bold">Résoudre ce conflit</h2><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Cette action ne modifie pas le fichier. Elle accepte explicitement l’état actuellement affiché et actualise la baseline locale après les contrôles de sécurité.</p></div><button className="rounded-xl bg-cyan-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50" type="button" disabled={busy !== null} onClick={() => resolve("keep-current")}>{busy === "keep-current" ? "Résolution…" : "Conserver le contenu actuel"}</button><details className="rounded-xl border p-3 text-sm"><summary className="cursor-pointer font-semibold">Actions avancées</summary><p className="mt-2 text-slate-600 dark:text-slate-300">À utiliser seulement si la détection elle-même est incorrecte.</p><button className="mt-3 rounded-xl border px-3 py-2 font-semibold disabled:opacity-50" type="button" disabled={busy !== null} onClick={() => resolve("false-positive")}>{busy === "false-positive" ? "Classement…" : "Classer comme faux positif"}</button></details>{error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}</section>;
}

export function ExpiredLocalConflictReacquireAction({ conflictId, backupIds }: { conflictId: string; backupIds: string[] }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  if (message) return <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950" role="status"><p className="font-semibold">{message}</p><p className="mt-1 text-sm">La baseline, le checkpoint et l’autorité locale correspondent désormais à l’état courant.</p><Link className="mt-3 inline-flex rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white" href="/portability">Retour à Portabilité</Link></div>;

  return <section className="space-y-4 rounded-2xl border border-amber-400 p-5" aria-labelledby="expired-local-reacquire-title">
    <div><h2 id="expired-local-reacquire-title" className="text-xl font-bold">Conserver le contenu actuel et réactiver l’écriture</h2><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Le fichier ne sera pas modifié. Son état actuel deviendra la nouvelle référence locale. Un backup knowledge vérifié est requis avant de réactiver l’autorité de cette machine.</p></div>
    <form className="space-y-3" aria-busy={busy} onSubmit={async (event) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true); setError(null);
      const form = new FormData(event.currentTarget);
      try {
        const key = idempotencyKey.current || crypto.randomUUID();
        idempotencyKey.current = key;
        const response = await fetch(`/api/portability/conflicts/${encodeURIComponent(conflictId)}/resolve`, {
          method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": key },
          body: JSON.stringify({ action: "keep-current-and-reacquire", backupId: form.get("backupId"), confirmationText: form.get("confirmationText") }),
        });
        const payload = await response.json() as ResolutionResponse;
        if (!response.ok) throw new Error(payload.error?.message || "La réactivation n’a pas abouti.");
        setMessage(payload.message || "Le contenu actuel est conservé et l’écriture est réactivée.");
      } catch (caught) { setError(caught instanceof Error ? caught.message : "La réactivation n’a pas abouti."); }
      finally { setBusy(false); }
    }}>
      <label className="block">Backup knowledge vérifié<select name="backupId" required defaultValue="" className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 dark:border-slate-700"><option value="" disabled>Sélectionnez le backup vérifié</option>{backupIds.map((backupId) => <option key={backupId} value={backupId}>Backup vérifié disponible</option>)}</select></label>
      <label className="block">Saisir exactement <strong>CONSERVER ET REACQUERIR</strong><input name="confirmationText" required autoComplete="off" className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 font-mono dark:border-slate-700" /></label>
      <button disabled={busy} className="rounded-xl bg-amber-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">{busy ? "Réactivation…" : "Conserver et réactiver l’écriture"}</button>
    </form>
    {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
  </section>;
}

export function LegacyWriterConflictAcknowledgement({ conflictId }: { conflictId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  if (message) return <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950" role="status"><p className="font-semibold">{message}</p><p className="mt-1 text-sm">L’enregistrement legacy original reste intact. Seule sa classification locale a été ajoutée.</p><Link className="mt-3 inline-flex rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white" href="/portability">Retour à Portabilité</Link></div>;

  return <section className="space-y-4 rounded-2xl border border-amber-300 p-5" aria-labelledby="legacy-writer-title">
    <div><h2 id="legacy-writer-title" className="text-xl font-bold">Classer l’ancien conflit writer</h2><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Cette action est réservée au type historique <code>stale-writer-authority</code> sans fichier associé. Elle ne modifie aucun Markdown, checkpoint ou fichier d’autorité.</p></div>
    <form className="space-y-3" onSubmit={async (event) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true); setError(null);
      const form = new FormData(event.currentTarget);
      try {
        const key = idempotencyKey.current || crypto.randomUUID();
        idempotencyKey.current = key;
        const response = await fetch(`/api/portability/conflicts/${encodeURIComponent(conflictId)}/acknowledge-legacy-writer`, {
          method: "POST",
          headers: { "content-type": "application/json", "Idempotency-Key": key },
          body: JSON.stringify({ confirmationText: form.get("confirmationText") }),
        });
        const payload = await response.json() as ResolutionResponse;
        if (!response.ok) throw new Error(payload.error?.message || "Le classement n’a pas abouti.");
        setMessage(payload.message || "Le conflit writer historique est classé.");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Le classement n’a pas abouti.");
      } finally { setBusy(false); }
    }}>
      <label className="block">Saisir exactement <strong>CLASSER LE CONFLIT WRITER HISTORIQUE</strong>
        <input name="confirmationText" required autoComplete="off" className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 font-mono dark:border-slate-700" />
      </label>
      <button disabled={busy} className="rounded-xl bg-amber-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">Classer comme informationnel</button>
    </form>
    {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
  </section>;
}
