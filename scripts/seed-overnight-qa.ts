import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MockAnalysisProvider } from "../src/lib/analysis-providers/mock";
import { generatePackage } from "../src/lib/chatgpt-packages/builder";
import { sha256 } from "../src/lib/imports/hash";
import { packageZip, validManifest } from "../src/lib/imports/test-utils";
import { createPortabilityBackup } from "../src/lib/portability/backup-builder";
import { createCheckpoint } from "../src/lib/portability/checkpoints";
import { getPortabilityConfig } from "../src/lib/portability/config";
import { createVaultSnapshot } from "../src/lib/portability/snapshots";
import { acquireWriterAuthority } from "../src/lib/portability/writer-authority";
import type { MachineIdentity } from "../src/lib/portability/types";
import { nextActionForState, workflowSchema, type WorkflowState } from "../src/lib/workflows/schema";

const root = path.resolve(process.env.TUBEKNOWLEDGE_QA_ROOT || path.join(os.tmpdir(), "tubeknowledge-playwright-qa"));
if (!root.toLocaleLowerCase("en").startsWith(path.resolve(os.tmpdir()).toLocaleLowerCase("en") + path.sep)) throw new Error("Le seed QA doit rester sous le dossier temporaire du système.");
const vault = path.join(root, "vault");
const runtime = path.join(root, "runtime");
const acquisitions = path.join(runtime, "acquisitions");
const workflows = path.join(runtime, "video-knowledge-workflows");
const state = path.join(root, "state");
const backups = path.join(root, "backups");
const now = "2026-07-27T04:00:00.000Z";
const machine: MachineIdentity = { schemaVersion: 1, machineId: "50000000-0000-4000-8000-000000000001", displayName: "Portable QA", createdAt: now, rolePreference: "reader" };

const ids = {
  selection: "10000000-0000-4000-8000-000000000001",
  acquiring: "10000000-0000-4000-8000-000000000002",
  transcript: "10000000-0000-4000-8000-000000000003",
  analysis: "10000000-0000-4000-8000-000000000004",
  result: "10000000-0000-4000-8000-000000000005",
  preview: "10000000-0000-4000-8000-000000000006",
  blocked: "10000000-0000-4000-8000-000000000007",
  imported: "10000000-0000-4000-8000-000000000008",
  package: "20000000-0000-4000-8000-000000000001",
  previewSession: "30000000-0000-4000-8000-000000000001",
  import: "40000000-0000-4000-8000-000000000001",
};

async function main() {
await rm(root, { recursive: true, force: true });
await Promise.all([
  mkdir(path.join(vault, "00_SYSTEME"), { recursive: true }),
  mkdir(path.join(vault, "01_BIBLIOTHEQUE", "Intelligence-artificielle"), { recursive: true }),
  mkdir(path.join(vault, "01_BIBLIOTHEQUE", "Alimentation"), { recursive: true }),
  mkdir(path.join(vault, "01_BIBLIOTHEQUE", "Demonstration"), { recursive: true }),
  mkdir(path.join(vault, "02_SOURCES"), { recursive: true }),
  mkdir(workflows, { recursive: true }),
  mkdir(state, { recursive: true }),
  mkdir(backups, { recursive: true }),
]);

await Promise.all([
  writeFile(path.join(vault, "INDEX.md"), "# Bibliothèque de démonstration\n\n- [[01_BIBLIOTHEQUE/Intelligence-artificielle/agents|Agents IA]]\n- [[01_BIBLIOTHEQUE/Alimentation/proteines|Protéines]]\n", "utf8"),
  writeFile(path.join(vault, "00_SYSTEME", "README.md"), "# Système\n\nFixture QA locale et temporaire.\n", "utf8"),
  writeFile(path.join(vault, "00_SYSTEME", "PROJECT_INSTRUCTIONS.md"), "# Instructions\n\nConserver la provenance et vérifier avant toute écriture.\n", "utf8"),
  writeFile(path.join(vault, "00_SYSTEME", "LIBRARY_RULES.md"), "# Règles de bibliothèque\n\nUtiliser des chemins relatifs et des sources vérifiables.\n", "utf8"),
  writeFile(path.join(vault, "00_SYSTEME", "TAXONOMY.md"), "# Taxonomie\n\n- Intelligence artificielle\n- Alimentation\n", "utf8"),
  writeFile(path.join(vault, "00_SYSTEME", "RULES.md"), "# Règles\n\nCiter les sources et signaler les inférences.\n", "utf8"),
  writeFile(path.join(vault, "01_BIBLIOTHEQUE", "Intelligence-artificielle", "agents.md"), "# Agents IA\n\n## Boucle agentique\n\nUn agent logiciel observe un état, choisit une action et vérifie son résultat. Le contexte et les garde-fous limitent les erreurs.\n\n## Mémoire\n\nUne mémoire externe doit conserver la provenance et rester vérifiable.\n", "utf8"),
  writeFile(path.join(vault, "01_BIBLIOTHEQUE", "Alimentation", "proteines.md"), "# Protéines\n\n## Repères\n\nLes protéines participent à la structure des tissus. Les besoins varient selon la personne et le contexte.\n", "utf8"),
  writeFile(path.join(vault, "01_BIBLIOTHEQUE", "Demonstration", "nouvelle-connaissance.md"), "# Nouvelle connaissance de démonstration\n\nCette note prouve le lien final du parcours temporaire.\n", "utf8"),
  writeFile(path.join(vault, "02_SOURCES", "videos.md"), "# Vidéos\n\n| Titre | URL | Sections | Statut |\n|---|---|---|---|\n| Comprendre les agents IA | https://www.youtube.com/watch?v=abcdefghijk | Intelligence artificielle | Importée |\n| Protéines au quotidien | https://www.youtube.com/watch?v=lmnopqrstuv | Alimentation | À revoir |\n", "utf8"),
  writeFile(path.join(state, "machine.json"), `${JSON.stringify(machine, null, 2)}\n`, "utf8"),
  writeFile(path.join(state, "conflicts.json"), "[]\n", "utf8"),
]);

type JobState = "waiting-for-selection" | "transcribing" | "completed";
async function job(id: string, status: JobState, progress: number | null, message: string) {
  const output = path.join(acquisitions, id, "output");
  await mkdir(output, { recursive: true });
  const completed = status === "completed";
  const value = {
    schemaVersion: 1, id, createdAt: now, updatedAt: now, status,
    stage: status === "waiting-for-selection" ? "inspection-complete" : completed ? "completed" : "transcribing",
    progress, message, title: "Comprendre les agents IA", sourceKind: completed ? "manual-subtitles" : undefined,
    source: { type: "youtube", canonicalUrl: `https://www.youtube.com/watch?v=${id.slice(-11)}`, videoId: id.slice(-11) },
    inspection: { videoId: id.slice(-11), title: "Comprendre les agents IA", durationSeconds: 754, canonicalUrl: `https://www.youtube.com/watch?v=${id.slice(-11)}`, language: "fr", chapters: [], liveStatus: "not-live", estimatedAudioBytes: 8_000_000, warnings: [], subtitles: [
      { language: "fr", name: "Français", origin: "manual", formats: [{ extension: "vtt" }] },
      { language: "en", name: "English", origin: "automatic", formats: [{ extension: "vtt" }] },
    ] }, warnings: [], artifacts: completed ? [{ kind: "transcript", name: "transcript.txt" }, { kind: "metadata", name: "metadata.json" }] : [],
  };
  await writeFile(path.join(acquisitions, id, "job.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  if (completed) {
    await writeFile(path.join(output, "transcript.txt"), "Les agents IA suivent une boucle observer, décider, agir et vérifier. La provenance des sources et les garde-fous restent essentiels.\n", "utf8");
    await writeFile(path.join(output, "metadata.json"), `${JSON.stringify({ schemaVersion: 1, jobId: id, title: value.title, language: "fr", sourceKind: "manual-subtitles", videoId: value.inspection.videoId, canonicalUrl: value.inspection.canonicalUrl, hashes: { "transcript.txt": sha256("Les agents IA suivent une boucle observer, décider, agir et vérifier. La provenance des sources et les garde-fous restent essentiels.\n") } })}\n`, "utf8");
  }
}

await Promise.all([
  job(ids.selection, "waiting-for-selection", null, "Inspection terminée."),
  job(ids.acquiring, "transcribing", 0.46, "Transcription locale en cours…"),
  job(ids.transcript, "completed", 1, "Transcript prêt."),
  job(ids.analysis, "completed", 1, "Transcript prêt."),
  job(ids.result, "completed", 1, "Transcript prêt."),
  job(ids.preview, "completed", 1, "Transcript prêt."),
  job(ids.blocked, "completed", 1, "Transcript prêt."),
  job(ids.imported, "completed", 1, "Transcript prêt."),
]);

const storedAnalysisPackage = await generatePackage({ action: "generate", acquisitionId: ids.analysis, selectedFiles: ["01_BIBLIOTHEQUE/Intelligence-artificielle/agents.md"], suggestedFilesRejected: [], allowStructuralUpdate: false }, { environment: process.env, processEnvironment: process.env, runtimeRoot: path.join(runtime, "chatgpt-packages"), packageId: ids.package, now: new Date(now) });
const validResultZip = await packageZip(validManifest({ packageId: ids.package, source: { type: "youtube-video", title: storedAnalysisPackage.manifest.source.title, url: storedAnalysisPackage.manifest.source.url } }));
await writeFile(path.join(root, "valid-analysis-result.zip"), validResultZip);

async function workflow(id: string, stateValue: WorkflowState, title: string, extras: Record<string, unknown> = {}) {
  const value = workflowSchema.parse({ schemaVersion: 1, workflowId: id, createdAt: now, updatedAt: now, state: stateValue, sourceUrl: `https://www.youtube.com/watch?v=${id.slice(-11)}`, videoId: id.slice(-11), title, acquisitionId: id, nextAction: nextActionForState(stateValue), reprocessingApproved: false, knowledgePaths: [], ...extras });
  await writeFile(path.join(workflows, `${id}.json`), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

await Promise.all([
  workflow(ids.selection, "source-selection", "Inspection réussie"),
  workflow(ids.acquiring, "acquiring", "Transcription en cours"),
  workflow(ids.transcript, "transcript-ready", "Transcript prêt"),
  workflow(ids.analysis, "analysis-ready", "Paquet manuel prêt", { packageId: ids.package }),
  workflow(ids.result, "result-received", "Résultat reçu", { packageId: ids.package }),
  workflow(ids.preview, "preview-ready", "Vérification prête", { packageId: ids.package, previewSessionId: ids.previewSession }),
  workflow(ids.blocked, "blocked-reader", "Vérification en attente", { packageId: ids.package, previewSessionId: ids.previewSession }),
  workflow(ids.imported, "imported", "Connaissance ajoutée", { packageId: ids.package, previewSessionId: ids.previewSession, importId: ids.import, knowledgePaths: ["01_BIBLIOTHEQUE/Demonstration/nouvelle-connaissance.md"] }),
]);

const mock = await new MockAnalysisProvider(() => new Date(now), () => "60000000-0000-4000-8000-000000000001").run({
  workflowId: ids.transcript,
  transcript: "Les agents IA observent, décident, agissent et vérifient.",
  metadata: { title: "Agents IA", sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk", videoId: "abcdefghijk", language: "fr" },
  context: [], writeScope: { createPrefixes: ["01_BIBLIOTHEQUE/"], replaceFiles: [] }, freshnessHash: "a".repeat(64), confirmedPaid: false,
});
if (!mock.importZip) throw new Error("Fixture mock absente.");
await writeFile(path.join(root, "mock-analysis.zip"), mock.importZip);

const portabilityNow = new Date();
const portabilityConfig = getPortabilityConfig(process.env);
const backup = await createPortabilityBackup(vault, portabilityConfig, machine, "knowledge", { now: portabilityNow, backupId: "70000000-0000-4000-8000-000000000001", gitCommit: "abcdef0", wait: async () => undefined });
const snapshot = await createVaultSnapshot(vault, machine.machineId, { now: portabilityNow });
const checkpoint = await createCheckpoint(vault, snapshot, "backup", { now: portabilityNow, checkpointId: "80000000-0000-4000-8000-000000000001", backupId: backup.backupId });
await acquireWriterAuthority(vault, machine, checkpoint, 120, { now: portabilityNow, force: true, verifiedBackupId: backup.backupId, confirmationText: "REPRENDRE", authorityId: "90000000-0000-4000-8000-000000000001" });
await writeFile(path.join(root, "fixture.json"), `${JSON.stringify({ root, vault, runtime, state, backups, ids, mockZip: path.join(root, "mock-analysis.zip"), requestZip: path.join(runtime, "chatgpt-packages", ids.package, "package.zip"), validResultZip: path.join(root, "valid-analysis-result.zip") }, null, 2)}\n`, "utf8");
console.log(`Seed QA prêt: ${root}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Échec du seed QA.");
  process.exitCode = 1;
});
