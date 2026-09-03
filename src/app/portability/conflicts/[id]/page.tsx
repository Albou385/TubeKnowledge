import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { ConflictResolutionActions, ExpiredLocalConflictReacquireAction, LegacyWriterConflictAcknowledgement, StaleBaselineReconcileAction } from "@/components/conflict-resolution-actions";
import { getPortabilityConfig } from "@/lib/portability/config";
import { describeConflict, loadConflicts } from "@/lib/portability/conflicts";
import { canOfferExpiredLocalConflictReacquire } from "@/lib/portability/expired-local-conflict-reacquire";
import { canOfferStaleBaselineReconcile } from "@/lib/portability/stale-baseline-expired-writer-reconcile";

export const dynamic = "force-dynamic";

const conflictLabels: Record<string, string> = {
  "content-divergence": "Divergence de contenu",
  "checkpoint-mismatch": "État différent du dernier checkpoint",
  "deleted-vs-modified": "Fichier supprimé ou déplacé",
  "case-collision": "Collision de casse",
  "duplicate-suspected": "Doublon possible",
  "onedrive-conflict-copy": "Copie de conflit possible",
  "unexpected-system-change": "Changement système inattendu",
  "stale-writer-authority": "Autorisation writer expirée",
  "incomplete-placeholder": "Fichier indisponible localement",
};

export default async function ConflictPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = (await loadConflicts(getPortabilityConfig())).find((value) => value.conflictId === id);
  if (!item) notFound();
  const details = describeConflict(item);
  const paths = Array.isArray(item.paths) ? item.paths : [];
  const canKeepCurrent = item.type === "content-divergence" && item.status === "open" && paths.length > 0;
  const staleBaselineReconcile = canKeepCurrent ? await canOfferStaleBaselineReconcile(item.conflictId) : null;
  const expiredLocalReacquire = canKeepCurrent && !staleBaselineReconcile ? await canOfferExpiredLocalConflictReacquire(item.conflictId) : null;
  const canAcknowledgeLegacyWriter = item.type === "stale-writer-authority" && item.status === "open" && paths.length === 0;
  return <><AppHeader /><main className="mx-auto max-w-3xl space-y-6 px-4 py-8"><h1 className="text-3xl font-bold">{conflictLabels[item.type] || "Conflit de portabilité"}</h1><dl className="grid gap-3 rounded-2xl border p-5"><div><dt className="font-semibold">Catégorie</dt><dd>{details.category === "knowledge" ? "Connaissance" : "Technique"}</dd></div><div><dt className="font-semibold">Sévérité</dt><dd>{item.severity === "blocking" ? "Bloquante" : "Avertissement"}</dd></div><div><dt className="font-semibold">Statut</dt><dd>{item.status === "open" ? "À résoudre" : item.status === "resolved" ? "Résolu" : "Faux positif"}</dd></div><div><dt className="font-semibold">Détection</dt><dd>{new Date(item.detectedAt).toLocaleString("fr-CA")}</dd></div><div><dt className="font-semibold">Fichier relatif</dt><dd className="font-mono text-sm">{paths.join(", ") || "Aucune connaissance — état global ou technique"}</dd></div><div><dt className="font-semibold">Comparaison</dt><dd>Baseline locale et état courant disponibles pour le contrôle serveur.</dd></div><div><dt className="font-semibold">Cause probable</dt><dd>{details.probableCause}</dd></div><div><dt className="font-semibold">Impact</dt><dd>{details.impact}</dd></div><div><dt className="font-semibold">Action recommandée</dt><dd>{details.recommendedAction}</dd></div></dl>{staleBaselineReconcile ? <StaleBaselineReconcileAction conflictId={item.conflictId} backupIds={staleBaselineReconcile.backupIds} /> : expiredLocalReacquire ? <ExpiredLocalConflictReacquireAction conflictId={item.conflictId} backupIds={expiredLocalReacquire.backupIds} /> : canKeepCurrent ? <ConflictResolutionActions conflictId={item.conflictId} /> : null}{canAcknowledgeLegacyWriter ? <LegacyWriterConflictAcknowledgement conflictId={item.conflictId} /> : null}<p className="text-sm text-slate-500">Toute action modifiant réellement une connaissance produit une Preview Phase 3; Apply reste séparé, confirmé, sauvegardé et transactionnel.</p></main></>;
}
