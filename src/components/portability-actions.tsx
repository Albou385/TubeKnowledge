"use client";
import { useEffect, useRef, useState } from "react";
import { createWriterBootstrapSubmissionGate } from "@/lib/portability/writer-bootstrap-client";

async function jsonAction(url: string, body: unknown, headers: Record<string, string> = {}) { const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || "Opération refusée."); return data; }
async function jsonRead(url: string) { const response = await fetch(url, { method: "GET", cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || "Lecture refusée."); return data; }

export function SnapshotButton() { const [message, setMessage] = useState(""); return <div><button className="rounded-xl bg-cyan-400 px-4 py-2 font-semibold text-slate-950" onClick={async () => { try { setMessage("Snapshot et fenêtre de stabilité en cours…"); const data = await jsonAction("/api/portability/snapshot", {}); setMessage(`Snapshot ${data.snapshot.rootHash.slice(0, 12)} · ${data.snapshot.fileCount} fichiers.`); } catch (error) { setMessage(error instanceof Error ? error.message : "Échec."); } }}>Vérifier l’état local</button><p role="status" className="mt-2 text-sm text-slate-500">{message}</p></div>; }

export function BackupButton({ profile = "knowledge" }: { profile?: "knowledge" | "full" | "before-write" }) { const [message, setMessage] = useState(""); return <div><button className="rounded-xl bg-emerald-400 px-4 py-2 font-semibold text-slate-950" onClick={async () => { try { setMessage("Backup et vérification en cours…"); const data = await jsonAction("/api/portability/backups", { profile }); setMessage(`Backup vérifié ${data.backup.backupId}.`); } catch (error) { setMessage(error instanceof Error ? error.message : "Échec."); } }}>Créer le backup {profile}</button><p role="status" className="mt-2 text-sm text-slate-500">{message}</p></div>; }

export function MachineSetupForm({ initialName = "", initialRole = "reader" }: { initialName?: string; initialRole?: "reader" | "writer" }) { const [message, setMessage] = useState(""); return <form className="space-y-4" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { const data = await jsonAction("/api/portability/config", { displayName: form.get("displayName"), rolePreference: form.get("rolePreference") }); setMessage(`Identité locale enregistrée : ${data.machine.displayName}.`); } catch (error) { setMessage(error instanceof Error ? error.message : "Échec."); } }}><label className="block">Nom de cette machine<input name="displayName" required maxLength={80} defaultValue={initialName} className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700" /></label><label className="block">Préférence locale<select name="rolePreference" defaultValue={initialRole} className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"><option value="reader">reader</option><option value="writer">writer</option></select></label><button className="rounded-xl bg-cyan-400 px-4 py-2 font-semibold text-slate-950">Enregistrer localement</button><p role="status">{message}</p></form>; }

export function WriterBootstrapButton({ pending, succeeded }: { pending: boolean; succeeded: boolean }) { return <button disabled={pending || succeeded} aria-busy={pending} className="rounded-xl bg-amber-400 px-4 py-2 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Initialisation en cours…" : succeeded ? "Autorité writer active" : "Créer checkpoint et acquérir writer"}</button>; }

export function WriterBootstrapForm({ writerAlreadyActive = false }: { writerAlreadyActive?: boolean }) {
  const [message, setMessage] = useState(writerAlreadyActive ? "Autorité writer déjà active" : "");
  const [pending, setPending] = useState(false);
  const [succeeded, setSucceeded] = useState(writerAlreadyActive);
  const [gate] = useState(() => createWriterBootstrapSubmissionGate());
  if (writerAlreadyActive) return <p role="status">Autorité writer déjà active</p>;
  return <form className="space-y-3" aria-busy={pending} onSubmit={async (event) => {
    event.preventDefault();
    if (!gate.begin()) return;
    setPending(true);
    setMessage("Initialisation en cours…");
    const form = new FormData(event.currentTarget);
    try {
      const result = await jsonAction("/api/portability/bootstrap-writer", {
        backupId: form.get("backupId"),
        confirmationText: form.get("confirmationText"),
      }, { "Idempotency-Key": crypto.randomUUID() });
      gate.succeed();
      setSucceeded(true);
      setMessage(result.outcome === "already-active" ? "Autorité writer déjà active" : "Autorité writer active.");
    } catch (error) {
      gate.fail();
      setMessage(error instanceof Error ? error.message : "Échec.");
    } finally {
      setPending(false);
    }
  }}><fieldset disabled={pending || succeeded} className="space-y-3"><label className="block">Backup vérifié initial<input name="backupId" required className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 font-mono dark:border-slate-700" /></label><label className="block">Saisir REPRENDRE<input name="confirmationText" required className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 font-mono dark:border-slate-700" /></label><WriterBootstrapButton pending={pending} succeeded={succeeded} /></fieldset><p role="status">{message}</p></form>;
}

export function WriterRenewForm() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const guard = useRef(false);
  return <form aria-busy={pending} onSubmit={async (event) => {
    event.preventDefault();
    if (guard.current) return;
    guard.current = true;
    setPending(true);
    setMessage("Renouvellement en cours…");
    try {
      await jsonAction("/api/portability/writer/renew", {}, { "Idempotency-Key": crypto.randomUUID() });
      setMessage("Lease writer renouvelé.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Échec.");
    } finally {
      guard.current = false;
      setPending(false);
    }
  }}><button disabled={pending} aria-busy={pending} className="rounded-xl bg-cyan-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">{pending ? "Renouvellement en cours…" : "Renouveler writer"}</button><p role="status" className="mt-2 text-sm">{message}</p></form>;
}

export function WriterReacquireForm({ suggestedBackupId = "" }: { suggestedBackupId?: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const guard = useRef(false);
  return <form className="space-y-3" aria-busy={pending} onSubmit={async (event) => {
    event.preventDefault();
    if (guard.current) return;
    guard.current = true;
    setPending(true);
    setMessage("Réacquisition en cours…");
    const form = new FormData(event.currentTarget);
    try {
      await jsonAction("/api/portability/writer/reacquire", {
        backupId: form.get("backupId"),
        confirmationText: form.get("confirmationText"),
      }, { "Idempotency-Key": crypto.randomUUID() });
      setMessage("Autorité writer réacquise.");
    } catch (error) {
      guard.current = false;
      setMessage(error instanceof Error ? error.message : "Échec.");
    } finally {
      setPending(false);
    }
  }}><fieldset disabled={pending} className="space-y-3"><label className="block">Backup vérifié correspondant à l’état actuel<input name="backupId" required defaultValue={suggestedBackupId} className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 font-mono dark:border-slate-700" /></label><label className="block">Saisir REACQUERIR<input name="confirmationText" required className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 font-mono dark:border-slate-700" /></label><button disabled={pending} aria-busy={pending} className="rounded-xl bg-amber-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">{pending ? "Réacquisition en cours…" : "Réacquérir writer"}</button></fieldset><p role="status" className="text-sm">{message}</p></form>;
}

interface DisasterRecoveryPreviewView {
  recoveryId: string;
  expiresAt: string;
  risks: string[];
}

export function WriterDisasterRecoveryForm({ suggestedBackupId = "" }: { suggestedBackupId?: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<DisasterRecoveryPreviewView | null>(null);
  const guard = useRef(false);
  const applyKey = useRef<string | null>(null);

  async function createPreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guard.current) return;
    guard.current = true;
    setPending(true);
    setMessage("Vérification read-only du writer, du vault, du checkpoint et du backup…");
    const form = new FormData(event.currentTarget);
    try {
      const data = await jsonAction("/api/portability/writer/disaster-recovery/preview", { backupId: form.get("backupId") });
      setPreview(data.preview as DisasterRecoveryPreviewView);
      applyKey.current = crypto.randomUUID();
      setMessage("Preview prête. Relisez tous les risques avant de confirmer.");
    } catch (error) {
      setPreview(null);
      applyKey.current = null;
      setMessage(error instanceof Error ? error.message : "Preview refusée.");
    } finally {
      guard.current = false;
      setPending(false);
    }
  }

  async function applyRecovery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guard.current || !preview) return;
    guard.current = true;
    setPending(true);
    setMessage("Revérification complète et reprise atomique du writer…");
    const form = new FormData(event.currentTarget);
    try {
      const key = applyKey.current || crypto.randomUUID();
      applyKey.current = key;
      await jsonAction("/api/portability/writer/disaster-recovery/apply", {
        recoveryId: preview.recoveryId,
        confirmationText: form.get("confirmationText"),
      }, { "Idempotency-Key": key });
      setMessage("Writer repris sur ce Portable. Rechargez la page pour vérifier l’autorité unique.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Récupération refusée.");
    } finally {
      guard.current = false;
      setPending(false);
    }
  }

  return <div className="space-y-4">
    <form className="space-y-3" aria-busy={pending} onSubmit={createPreview}>
      <label className="block">Backup knowledge vérifié correspondant exactement au vault
        <input name="backupId" required defaultValue={suggestedBackupId} className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 font-mono dark:border-slate-700" />
      </label>
      <button disabled={pending} className="rounded-xl border border-amber-400 px-4 py-2 font-semibold disabled:opacity-50">Prévisualiser la récupération</button>
    </form>
    {preview ? <form className="space-y-3 rounded-xl border border-rose-400 p-4" aria-busy={pending} onSubmit={applyRecovery}>
      <h3 className="font-bold">Risque de double writer</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm">{preview.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul>
      <p className="text-sm text-slate-500">Cette Preview locale expire à {new Date(preview.expiresAt).toLocaleString("fr-CA")} et sera entièrement revérifiée par Apply.</p>
      <label className="block">Si la machine source est définitivement indisponible, saisir exactement :<br /><strong>REPRENDRE LE WRITER SUR CE PORTABLE</strong>
        <input name="confirmationText" required autoComplete="off" className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 font-mono dark:border-slate-700" />
      </label>
      <button disabled={pending} className="rounded-xl bg-rose-500 px-4 py-2 font-semibold text-white disabled:opacity-50">Appliquer la récupération d’urgence</button>
    </form> : null}
    <p role="status" className="text-sm">{message}</p>
  </div>;
}

interface PendingDisasterRecoveryView {
  recoveryId: string;
  startedAt: string;
}

export function WriterDisasterRecoveryResume() {
  const [pendingRecovery, setPendingRecovery] = useState<PendingDisasterRecoveryView | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const guard = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void jsonRead("/api/portability/writer/disaster-recovery/pending")
      .then((data) => { if (!cancelled) setPendingRecovery(data.pending as PendingDisasterRecoveryView | null); })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "État de reprise illisible."); });
    return () => { cancelled = true; };
  }, []);

  if (!pendingRecovery && !message) return null;
  return <section className="space-y-3 rounded-2xl border border-amber-400 p-5">
    <h2 className="text-xl font-bold">Finaliser une récupération interrompue</h2>
    {pendingRecovery ? <>
      <p>Une reprise writer commencée le {new Date(pendingRecovery.startedAt).toLocaleString("fr-CA")} a remplacé l’autorité, mais son journal local n’est pas finalisé. Vérifiez que la machine source reste définitivement indisponible.</p>
      <form className="space-y-3" aria-busy={pending} onSubmit={async (event) => {
        event.preventDefault();
        if (guard.current) return;
        guard.current = true;
        setPending(true);
        const form = new FormData(event.currentTarget);
        try {
          await jsonAction("/api/portability/writer/disaster-recovery/resume", {
            recoveryId: pendingRecovery.recoveryId,
            confirmationText: form.get("confirmationText"),
          });
          setPendingRecovery(null);
          setMessage("Récupération interrompue finalisée et auditée.");
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Finalisation refusée.");
        } finally {
          guard.current = false;
          setPending(false);
        }
      }}>
        <label className="block">Saisir de nouveau <strong>REPRENDRE LE WRITER SUR CE PORTABLE</strong>
          <input name="confirmationText" required autoComplete="off" className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 font-mono dark:border-slate-700" />
        </label>
        <button disabled={pending} className="rounded-xl bg-amber-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">Finaliser la reprise locale</button>
      </form>
    </> : null}
    <p role="status" className="text-sm">{message}</p>
  </section>;
}

export function SingleMachineModeForm({ enabled, reminderMinutes }: { enabled: boolean; reminderMinutes: number }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const guard = useRef(false);
  return <form className="space-y-3" aria-busy={pending} onSubmit={async (event) => {
    event.preventDefault();
    if (guard.current) return;
    guard.current = true;
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      await jsonAction("/api/portability/operation-settings", {
        singleMachineMode: form.get("singleMachineMode") === "on",
        renewalReminderMinutes: Number(form.get("renewalReminderMinutes")),
      });
      setMessage(form.get("singleMachineMode") === "on" ? "Mode mono-machine enregistré. Le renouvellement automatique sera actif tant que le serveur fonctionne et que cette machine conserve l’autorisation." : "Mode mono-machine désactivé. Le renouvellement automatique est suspendu.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Échec.");
    } finally {
      guard.current = false;
      setPending(false);
    }
  }}><label className="flex items-start gap-2"><input name="singleMachineMode" type="checkbox" defaultChecked={enabled} /> <span><strong>Mode mono-machine temporaire</strong><br /><span className="text-sm text-slate-500">Renouvelle uniquement l’autorisation locale existante tant que le serveur fonctionne. Ne crée jamais une autorisation et ne vérifie pas le cloud.</span></span></label><label className="block text-sm">Renouveler avant l’expiration (minutes)<input name="renewalReminderMinutes" type="number" min={1} max={1440} defaultValue={reminderMinutes} className="mt-1 w-32 rounded-xl border bg-transparent px-3 py-2" /></label><button disabled={pending} aria-busy={pending} className="rounded-xl border px-4 py-2 disabled:opacity-50">{pending ? "Enregistrement…" : "Enregistrer le mode local"}</button><p role="status" className="text-sm">{message}</p></form>;
}

export function HandoffForm() { const [message, setMessage] = useState(""); return <form className="space-y-3" onSubmit={async (event) => { event.preventDefault(); const backupId = new FormData(event.currentTarget).get("backupId"); try { const data = await jsonAction("/api/portability/handoff", { backupId }); setMessage(`Handoff ${data.handoff.handoffId} préparé. Attendez OneDrive manuellement.`); } catch (error) { setMessage(error instanceof Error ? error.message : "Échec."); } }}><label className="block">UUID du backup vérifié<input name="backupId" required className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 font-mono dark:border-slate-700" /></label><button className="rounded-xl bg-amber-400 px-4 py-2 font-semibold text-slate-950">Préparer et libérer writer</button><p role="status">{message}</p></form>; }

export function RestoreForm({ backupId }: { backupId: string }) { const [message, setMessage] = useState(""); return <form className="space-y-4" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const mode = String(form.get("mode")); try { const preview = await jsonAction(`/api/portability/backups/${backupId}/restore-preview`, { mode, stagingPath: form.get("stagingPath") || undefined, mirror: form.get("mirror") === "on" }); if (!confirm(`Preview : ${preview.preview.operations.length} opérations. Continuer ?`)) return; const result = await jsonAction(`/api/portability/backups/${backupId}/restore`, { restoreId: preview.preview.restoreId, confirmed: true, confirmationText: mode === "restore-in-place" ? String(form.get("confirmationText")) : undefined }); setMessage(`Restauration : ${result.result.status}.`); } catch (error) { setMessage(error instanceof Error ? error.message : "Échec."); } }}><label className="block">Mode<select name="mode" className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 dark:border-slate-700"><option value="restore-to-staging">Vers staging (défaut)</option><option value="restore-in-place">Sur place (renforcé)</option></select></label><label className="block">Destination staging explicite<input name="stagingPath" className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 dark:border-slate-700" /></label><label className="flex gap-2"><input name="mirror" type="checkbox" /> Rendre identique au backup (archives et confirmation renforcée)</label><label className="block">Pour in-place, saisir RESTAURER<input name="confirmationText" className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 font-mono dark:border-slate-700" /></label><button className="rounded-xl bg-rose-400 px-4 py-2 font-semibold text-slate-950">Prévisualiser puis restaurer</button><p role="status">{message}</p></form>; }
