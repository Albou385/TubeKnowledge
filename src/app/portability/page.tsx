import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { SnapshotButton, WriterDisasterRecoveryForm, WriterDisasterRecoveryResume } from "@/components/portability-actions";
import { presentAutomaticRenewal, presentWriterState } from "@/lib/diagnostics/overview";
import { getPortabilityStatus } from "@/lib/portability/status";

export const dynamic = "force-dynamic";

function duration(seconds: number | null): string {
  if (seconds === null) return "Non applicable";
  if (seconds <= 0) return "Expiré";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
}

export default async function PortabilityPage() {
  const status = await getPortabilityStatus();
  const writer = presentWriterState(status.writer.state, status.writer.recommendedAction);
  const renewal = presentAutomaticRenewal(status.writer.state, status.operationSettings.singleMachineMode);
  const cards = [
    ["Machine locale", status.machine ? `${status.machine.displayName} · préférence ${status.machine.rolePreference}` : "Non configurée"],
    ["Autorisation d’écriture", writer.label],
    ["Fonctionnement quotidien", renewal.label],
    ["Écriture permise", status.writer.canWrite ? "Oui — safety gate toujours revérifié" : `Non${status.writer.blockingReason ? ` — ${status.writer.blockingReason}` : ""}`],
    ["Dernier backup", status.backups.latest ? `${status.backups.latest.profile} · ${status.backups.latest.verified ? "vérifié" : "non vérifié"} · ${status.backups.latest.trigger} · il y a ${duration(status.backups.latest.ageSeconds)}` : "Absent"],
    ["Conflits de connaissance", status.conflicts.knowledge ? `${status.conflicts.knowledge} à examiner` : "Aucun conflit détecté"],
    ["Cloud", status.readiness.cloudState],
  ];
  return <><AppHeader /><main className="mx-auto max-w-6xl space-y-6 px-4 py-8"><div><p className="text-sm font-semibold uppercase tracking-widest text-cyan-500">Utilisation locale</p><h1 className="text-3xl font-bold">Portabilité Tour ↔ Portable</h1><p className="mt-2 text-slate-500">Une seule machine peut écrire. TubeKnowledge vérifie l’état local, mais ne peut pas certifier la synchronisation OneDrive.</p></div><section className="grid gap-4 md:grid-cols-3">{cards.map(([label, value]) => <article key={label} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"><h2 className="text-sm font-semibold text-slate-500">{label}</h2><p className="mt-2 font-medium">{value}</p></article>)}</section><div className="flex flex-wrap gap-3"><SnapshotButton /><Link className="rounded-xl bg-cyan-400 px-4 py-2 font-semibold text-slate-950" href="/portability/setup">Gérer l’autorisation d’écriture</Link>{status.conflicts.open ? <Link className="rounded-xl border px-4 py-2" href="/portability/conflicts">Examiner le conflit</Link> : null}<Link className="rounded-xl border px-4 py-2" href="/portability/backups">Créer ou vérifier un backup</Link><Link className="rounded-xl border px-4 py-2" href="/portability/handoff">Changer de machine</Link></div><WriterDisasterRecoveryResume />{status.writer.state === "expired-remote" ? <section className="space-y-3 rounded-2xl border border-rose-400 p-5"><h2 className="text-xl font-bold">Machine source définitivement indisponible</h2><p>Ce parcours exceptionnel ne remplace pas un handoff normal. Il reste refusé pendant 24 heures après l’expiration du writer distant et exige un vault stable, zéro conflit, zéro handoff actif, le checkpoint exact et un backup knowledge vérifié.</p><WriterDisasterRecoveryForm suggestedBackupId={status.backups.latest?.verified && status.backups.latest.profile === "knowledge" ? status.backups.latest.backupId : ""} /></section> : null}<details className="rounded-2xl border border-slate-200 p-4 text-sm dark:border-slate-800"><summary className="cursor-pointer font-semibold">Détails techniques</summary><dl className="mt-4 grid gap-3 md:grid-cols-2"><div><dt className="text-slate-500">État writer</dt><dd>{status.writer.state}</dd></div><div><dt className="text-slate-500">Propriétaire</dt><dd>{status.writer.displayName || "Aucun"}</dd></div><div><dt className="text-slate-500">Lease et TTL restant</dt><dd>{status.writer.expiresAt ? `${duration(status.writer.leaseRemainingSeconds)} · ${new Date(status.writer.expiresAt).toLocaleString("fr-CA")}` : "Absent"}</dd></div><div><dt className="text-slate-500">Checkpoint / rootHash</dt><dd>{status.checkpoint ? `${status.checkpoint.rootHash} · ${status.checkpoint.action}` : "Absent"}</dd></div><div><dt className="text-slate-500">Conflits</dt><dd>{status.conflicts.open} ouvert(s) · {status.conflicts.blocking} bloquant(s) · {status.conflicts.technical} technique(s)</dd></div><div><dt className="text-slate-500">Action interne recommandée</dt><dd>{status.writer.recommendedAction}</dd></div></dl></details></main></>;
}
