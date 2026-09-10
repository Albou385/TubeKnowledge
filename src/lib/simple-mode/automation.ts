import { analysisProviders, defaultAnalysisProvider } from "@/lib/analysis-providers/registry";
import { loadPackageAcquisition } from "@/lib/chatgpt-packages/acquisition";
import { loadContextSelection, suggestContextFiles } from "@/lib/chatgpt-packages/context";
import { applyImport } from "@/lib/imports/apply";
import { sha256 } from "@/lib/imports/hash";
import { previewImport } from "@/lib/imports/preview";
import { readImportSession } from "@/lib/imports/sessions";
import type { ImportSession } from "@/lib/imports/types";
import { getTranscriptionConfig } from "@/lib/transcription/config";
import { getAcquisitionManager } from "@/lib/transcription/manager";
import { recommendedSubtitleTrack } from "@/lib/transcription/subtitle-tracks";
import type { SubtitleTrack } from "@/lib/transcription/types";
import { attachPreviewToWorkflow, markWorkflowImported, startWorkflowAcquisition, synchronizeWorkflow } from "@/lib/workflows/orchestrator";
import { loadWorkflow, transitionWorkflow, updateWorkflow } from "@/lib/workflows/runtime";
import type { VideoKnowledgeWorkflow } from "@/lib/workflows/schema";

const NOTION_PATH = /^01_BIBLIOTHEQUE\/[^/]+\/[^/]+\/[^/]+\.md$/u;
const APPEND_ONLY_PATH = /^(?:01_BIBLIOTHEQUE\/[^/]+\/[^/]+\/INDEX\.md|02_SOURCES\/videos\.md)$/u;
const automaticAnalyses = new Map<string, Promise<VideoKnowledgeWorkflow>>();

function appendOnly(before: string | null, after: string): boolean {
  if (before === null) return false;
  return after.startsWith(before.replace(/\s*$/u, ""));
}

export function isSafeSimpleModeSession(session: Pick<ImportSession, "manifest" | "operations">): boolean {
  if (session.manifest.structuralChange.level !== "none" || session.manifest.structuralChange.confirmationRequired) return false;
  return session.operations.length > 0 && session.operations.every((operation) => {
    if (operation.type === "create") return NOTION_PATH.test(operation.path);
    return (NOTION_PATH.test(operation.path) || APPEND_ONLY_PATH.test(operation.path)) && appendOnly(operation.beforeContent, operation.content);
  });
}

function languageFamily(language: string): string {
  return language.toLocaleLowerCase("en").split(/[-_]/u, 1)[0] ?? language;
}

export function selectOriginalSubtitleTrack(tracks: SubtitleTrack[], detectedLanguage?: string): SubtitleTrack | undefined {
  // Une langue inconnue ne permet pas de distinguer une piste originale d'une
  // traduction. Le flux simple bascule alors vers Whisper, qui détecte la langue.
  if (!detectedLanguage) return undefined;
  const originalTracks = tracks.filter((track) => languageFamily(track.language) === languageFamily(detectedLanguage));
  return recommendedSubtitleTrack(originalTracks, detectedLanguage);
}

export function automaticTranscriptionSource(
  subtitles: SubtitleTrack[],
  detectedLanguage: string | undefined,
): { kind: "subtitles"; language: string; origin: "manual" | "automatic"; format: "vtt" | "srt" } | {
  kind: "whisper"; profile: "fast"; confirmModelDownload: true; confirmLongVideo: true;
} {
  const track = selectOriginalSubtitleTrack(subtitles, detectedLanguage);
  if (track) return { kind: "subtitles", language: track.language, origin: track.origin, format: track.formats[0].extension };
  // Whisper reçoit volontairement aucune langue: le worker transcrit (sans
  // traduire) et persiste sa langue détectée dans les métadonnées du package.
  return { kind: "whisper", profile: "fast", confirmModelDownload: true, confirmLongVideo: true };
}

function configuredLibraryLanguage(environment: NodeJS.ProcessEnv): string {
  return environment.TUBEKNOWLEDGE_LIBRARY_LANGUAGE?.trim() || "fr";
}

async function automaticAnalysisInput(workflow: VideoKnowledgeWorkflow, environment: NodeJS.ProcessEnv) {
  if (!workflow.acquisitionId || !workflow.videoId) throw new Error("Transcription ou vidéo absente.");
  const transcriptionConfig = getTranscriptionConfig(environment);
  const acquisition = await loadPackageAcquisition(workflow.acquisitionId, transcriptionConfig);
  const suggested = await suggestContextFiles(workflow.acquisitionId, 12, { environment, transcriptionConfig });
  const context = await loadContextSelection(suggested.map((item) => item.relativePath), environment);
  const selected = [...context.required, ...context.selected].slice(0, 100);
  const language = typeof acquisition.metadata.language === "string" ? acquisition.metadata.language : acquisition.job.options?.language ?? "und";
  return {
    workflowId: workflow.workflowId,
    libraryLanguage: configuredLibraryLanguage(environment),
    transcript: acquisition.transcript,
    metadata: {
      title: workflow.title ?? acquisition.job.title ?? "Vidéo sans titre",
      sourceUrl: workflow.sourceUrl,
      videoId: workflow.videoId,
      language,
    },
    context: selected.map(({ relativePath, content, sha256: contextHash }) => ({ relativePath, content, sha256: contextHash })),
    writeScope: {
      createPrefixes: ["01_BIBLIOTHEQUE/"] as ["01_BIBLIOTHEQUE/"],
      replaceFiles: [...new Set([...context.selected.map((item) => item.relativePath), "02_SOURCES/videos.md"])],
    },
    freshnessHash: sha256([acquisition.transcript, ...selected.map((item) => item.sha256)].join("\0")),
    confirmedPaid: true,
  };
}

async function startAutomaticAnalysis(workflow: VideoKnowledgeWorkflow, environment: NodeJS.ProcessEnv): Promise<VideoKnowledgeWorkflow> {
  const providerId = defaultAnalysisProvider(environment);
  const provider = analysisProviders(environment)[providerId];
  const availability = provider.availability(environment);
  if (!availability.automatic || !availability.configured) {
    return updateWorkflow(workflow.workflowId, {
      lastErrorCode: "AI_PROVIDER_CONFIGURATION_REQUIRED",
      nextAction: "Vérification nécessaire : configurez un fournisseur d’analyse automatique.",
    });
  }

  try {
    await transitionWorkflow(workflow.workflowId, "analysis-preparing", {
      lastErrorCode: undefined,
      nextAction: "Analyse en cours.",
    });
    const input = await automaticAnalysisInput(workflow, environment);
    const result = await provider.run(input);
    if (result.status !== "completed" || !result.importZip) {
      return updateWorkflow(workflow.workflowId, {
        lastErrorCode: result.publicErrorCode ?? "AI_ANALYSIS_FAILED",
        nextAction: "Vérification nécessaire : l’analyse automatique doit être relancée explicitement.",
      });
    }

    await transitionWorkflow(workflow.workflowId, "analysis-ready", { lastErrorCode: undefined });
    const preview = await previewImport(result.importZip, { environment });
    const safe = preview.canApply && isSafeSimpleModeSession(await readImportSession(preview.sessionId));
    const reviewed = await attachPreviewToWorkflow(workflow.workflowId, { previewSessionId: preview.sessionId, canApply: safe }, { environment });
    if (!safe || reviewed.state !== "preview-ready") return reviewed;

    const applied = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment });
    if (applied.status !== "success") {
      return updateWorkflow(workflow.workflowId, {
        lastErrorCode: applied.failure?.code ?? "AUTO_APPLY_FAILED",
        nextAction: "Vérification nécessaire avant tout nouvel ajout.",
      });
    }
    return markWorkflowImported(workflow.workflowId, { importId: applied.importId }, { environment });
  } catch {
    return updateWorkflow(workflow.workflowId, {
      lastErrorCode: "AI_ANALYSIS_PREPARATION_FAILED",
      nextAction: "Vérification nécessaire : l’analyse automatique doit être relancée explicitement.",
    });
  }
}

/**
 * Avance une seule fois le flux simple. Une analyse marquée en cours n’est jamais
 * rejouée après interruption : elle exige une intervention explicite.
 */
export async function advanceSimpleModeWorkflow(workflowId: string, environment: NodeJS.ProcessEnv = process.env): Promise<VideoKnowledgeWorkflow> {
  let workflow = await loadWorkflow(workflowId);
  if (workflow.state === "source-selection" && workflow.acquisitionId) {
    const acquisition = await getAcquisitionManager().get(workflow.acquisitionId).catch(() => null);
    const inspection = acquisition?.inspection ?? null;
    if (!inspection) return updateWorkflow(workflowId, { lastErrorCode: "INSPECTION_UNAVAILABLE", nextAction: "Vérification nécessaire : l’inspection doit être reprise explicitement." });
    workflow = await startWorkflowAcquisition(
      workflowId,
      automaticTranscriptionSource(inspection.subtitles, inspection.language),
      { environment },
    );
  }
  if (workflow.state === "acquiring") workflow = await synchronizeWorkflow(workflowId, { environment });
  if (workflow.state === "transcript-ready" && !workflow.lastErrorCode) {
    const inFlight = automaticAnalyses.get(workflowId);
    if (inFlight) return inFlight;
    const analysis = startAutomaticAnalysis(workflow, environment).finally(() => automaticAnalyses.delete(workflowId));
    automaticAnalyses.set(workflowId, analysis);
    return analysis;
  }
  return workflow;
}
