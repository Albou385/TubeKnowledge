import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { MachineSetupForm, SingleMachineModeForm, WriterBootstrapForm, WriterReacquireForm, WriterRenewForm } from "@/components/portability-actions";
import { getPortabilityStatus } from "@/lib/portability/status";
import { writerWorkflowForState } from "@/lib/portability/writer-state";

export const dynamic = "force-dynamic";

function WriterWorkflow({ status }: { status: Awaited<ReturnType<typeof getPortabilityStatus>> }) {
  const writer = status.writer;
  const workflow = writerWorkflowForState(writer.state);
  if (workflow === "bootstrap") return <section className="space-y-3 rounded-2xl border p-5"><h2 className="text-xl font-bold">Bootstrap writer initial</h2><p className="text-sm">Ce workflow est disponible une seule fois. Il exige un backup vérifié et crée le checkpoint initial.</p><WriterBootstrapForm /></section>;
  if (workflow === "renew") return <section className="space-y-3 rounded-2xl border p-5"><h2 className="text-xl font-bold">Autorité writer active</h2><p>Le lease est valide et appartient à cette machine. Le renouvellement ne crée ni backup ni checkpoint.</p><WriterRenewForm /></section>;
  if (workflow === "reacquire") return <section className="space-y-3 rounded-2xl border border-amber-300 p-5"><h2 className="text-xl font-bold">Lease writer local expiré</h2><p>Le writer a déjà été initialisé. Utilisez la réacquisition, jamais le bootstrap initial.</p><WriterReacquireForm suggestedBackupId={status.backups.latest?.verified ? status.backups.latest.backupId : ""} /></section>;
  if (workflow === "conflict") return <section className="space-y-3 rounded-2xl border border-rose-400 p-5"><h2 className="text-xl font-bold">Action writer bloquée</h2><p>{writer.blockingReason}</p><Link className="inline-block rounded-xl border px-4 py-2" href="/portability/conflicts">Examiner le conflit</Link></section>;
  if (workflow === "handoff") return <section className="rounded-2xl border p-5"><h2 className="text-xl font-bold">Handoff en attente</h2><p>Terminez ou laissez expirer le handoff avant toute autre action writer.</p></section>;
  if (workflow === "remote") return <section className="rounded-2xl border p-5"><h2 className="text-xl font-bold">Autorité distante</h2><p>Cette machine ne peut pas acquérir writer. Utilisez le protocole de handoff depuis la machine propriétaire.</p></section>;
  return <section className="rounded-2xl border p-5"><h2 className="text-xl font-bold">État local indisponible</h2><p>{writer.blockingReason || "Vérifiez la disponibilité locale avant toute action writer."}</p></section>;
}

export default async function SetupPage() {
  const status = await getPortabilityStatus();
  return <><AppHeader /><main className="mx-auto max-w-2xl space-y-6 px-4 py-8"><h1 className="text-3xl font-bold">Configuration et cycle de vie writer</h1><p>Cette identité et le mode opérationnel restent sur cette machine. Aucun SID, MAC, IP ou chemin absolu n’est envoyé au navigateur.</p><MachineSetupForm initialName={status.machine?.displayName} initialRole={status.machine?.rolePreference} /><p className="rounded-xl border border-amber-300 p-4 text-sm">Les chemins state et backup doivent être configurés hors OneDrive dans <code>.env.local</code>. Cette page ne modifie jamais ce fichier.</p><WriterWorkflow status={status} /><section className="space-y-3 rounded-2xl border p-5"><h2 className="text-xl font-bold">Utilisation sur la tour seulement</h2><SingleMachineModeForm enabled={status.operationSettings.singleMachineMode} reminderMinutes={status.operationSettings.renewalReminderMinutes} /><p className="text-sm text-slate-500">Désactivez ce mode avant de préparer un handoff. Après un arrêt prolongé, une réacquisition explicite peut rester nécessaire.</p></section></main></>;
}
