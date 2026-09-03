import { readdir } from "node:fs/promises";

import { defaultAnalysisProvider, listAnalysisProviderAvailability } from "@/lib/analysis-providers/registry";
import { inspectLibrary } from "@/lib/library/library-reader";
import { getPortabilityStatus } from "@/lib/portability/status";
import { APP_VERSION } from "@/lib/release/version";
import { inspectTranscriptionHealth } from "@/lib/transcription/health";
import { getRuntimeLocation } from "@/lib/transcription/runtime-location";
import { listWorkflows } from "@/lib/workflows/runtime";
import type { WriterEffectiveState, WriterRecommendedAction } from "@/lib/portability/types";

const WRITER_STATE_LABELS: Record<WriterEffectiveState, string> = {
  uninitialized: "Autorisation d’écriture non initialisée",
  "active-local": "Écriture autorisée sur cette machine",
  "active-remote": "Écriture autorisée sur l’autre machine",
  "expired-local": "Autorisation d’écriture expirée sur cette machine",
  "expired-remote": "L’autorisation précédente appartient à l’autre machine et a expiré",
  "handoff-pending-local": "Transfert d’écriture préparé sur cette machine",
  "handoff-pending-remote": "Transfert d’écriture en attente depuis l’autre machine",
  "blocked-by-conflict": "Écriture bloquée par un conflit de connaissance",
  unavailable: "Autorisation d’écriture indisponible",
};

const WRITER_ACTIONS: Record<WriterRecommendedAction, { label: string; href: string }> = {
  bootstrap: { label: "Initialiser prudemment l’écriture", href: "/portability/setup" },
  renew: { label: "Renouveler l’autorisation", href: "/portability" },
  reacquire: { label: "Réacquérir explicitement l’autorisation", href: "/portability" },
  "examine-conflict": { label: "Examiner les conflits", href: "/portability/conflicts" },
  "wait-for-handoff": { label: "Vérifier le transfert entre machines", href: "/portability/handoff" },
  "verify-local": { label: "Vérifier l’état local", href: "/portability" },
  configure: { label: "Configurer la portabilité", href: "/portability/setup" },
  none: { label: "Aucune action requise", href: "/portability" },
};

export function presentWriterState(state: WriterEffectiveState, action: WriterRecommendedAction) {
  return { state, label: WRITER_STATE_LABELS[state], action: WRITER_ACTIONS[action] };
}

export function presentAutomaticRenewal(state: WriterEffectiveState, enabled: boolean) {
  if (!enabled) return { active: false, label: "Renouvellement automatique désactivé" };
  if (state === "active-local") return { active: true, label: "Renouvellement automatique actif sur la tour" };
  if (state === "expired-local") return { active: false, label: "Autorisation expirée après arrêt prolongé" };
  if (["active-remote", "expired-remote", "handoff-pending-local", "handoff-pending-remote"].includes(state)) {
    return { active: false, label: "Handoff requis pour changer de machine" };
  }
  if (state === "blocked-by-conflict") return { active: false, label: "Renouvellement suspendu par un conflit de connaissance" };
  return { active: false, label: "Renouvellement en attente d’une autorisation locale" };
}

async function countEntries(directory: string): Promise<number> {
  try {
    return (await readdir(directory)).length;
  } catch {
    return 0;
  }
}

export async function getDiagnosticOverview(environment: NodeJS.ProcessEnv = process.env) {
  const library = await inspectLibrary(environment);
  const providers = listAnalysisProviderAvailability(environment);
  const portability = await getPortabilityStatus(environment);
  const writerPresentation = presentWriterState(portability.writer.state, portability.writer.recommendedAction);
  const automaticRenewal = presentAutomaticRenewal(portability.writer.state, portability.operationSettings.singleMachineMode);

  let transcription: Awaited<ReturnType<typeof inspectTranscriptionHealth>>;
  let acquisitions = 0;
  let workflows = 0;
  try {
    const runtime = getRuntimeLocation(environment);
    [transcription, acquisitions, workflows] = await Promise.all([
      inspectTranscriptionHealth(environment),
      countEntries(runtime.acquisitionsPath),
      listWorkflows().then((items) => items.length),
    ]);
  } catch {
    transcription = {
      status: "incomplete",
      realExecution: "not-tested",
      cpuFirst: true,
      items: [{ name: "Configuration", status: "INCOMPATIBLE", detail: "Le runtime local est mal configuré." }],
    };
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    version: process.env.npm_package_version ?? APP_VERSION,
    readOnly: true,
    pathsExposed: false,
    vault: {
      status: library.available ? "ready" : "incomplete",
      configured: library.configValid,
      accessible: library.accessible,
      indexPresent: library.indexPresent,
      markdownFiles: library.available ? library.stats.markdownFiles : 0,
      message: library.available ? "Bibliothèque Markdown lisible." : library.message,
    },
    transcription,
    analysis: {
      defaultProvider: defaultAnalysisProvider(environment),
      providers,
    },
    portability: {
      enabled: portability.enabled,
      configured: portability.configured,
      writerState: portability.writer.state,
      writerLabel: writerPresentation.label,
      automaticRenewal,
      recommendedAction: writerPresentation.action,
      canWrite: portability.writer.canWrite,
      cloudVerified: false,
      backupCount: portability.backups.count,
      verifiedBackups: portability.backups.verified,
      openConflicts: portability.conflicts.open,
      knowledgeConflicts: portability.conflicts.knowledge,
      technicalConflicts: portability.conflicts.technical,
    },
    runtimes: { acquisitions, workflows },
    recentErrors: {
      persisted: Boolean(transcription.recentFailureCode),
      count: transcription.recentFailureCode ? 1 : 0,
      code: transcription.recentFailureCode,
      message: transcription.recentFailureCode
        ? `Un échec récent est enregistré sous le code sûr ${transcription.recentFailureCode}. Le stderr brut reste côté serveur.`
        : "Aucun échec récent n’est exposé; les détails sensibles restent côté serveur.",
    },
  };
}
