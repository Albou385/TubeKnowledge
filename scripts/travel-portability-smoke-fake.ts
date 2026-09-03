import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPortabilityBackup } from "../src/lib/portability/backup-builder";
import { verifyPortabilityBackup } from "../src/lib/portability/backup-reader";
import { createCheckpoint } from "../src/lib/portability/checkpoints";
import type { PortabilityConfig } from "../src/lib/portability/config";
import { ensureMachineIdentity } from "../src/lib/portability/machine-identity";
import { importColdMigrationBundle, previewColdMigrationImport } from "../src/lib/portability/migration";
import { parseMigrationArchive } from "../src/lib/portability/migration-archive";
import { saveOperationSettings } from "../src/lib/portability/operation-settings";
import { createStableSnapshot } from "../src/lib/portability/snapshots";
import { getPortabilityStatus } from "../src/lib/portability/status";
import { acceptExtendedAbsenceHandoff, readExtendedAbsenceHandoff } from "../src/lib/portability/travel-handoff";
import { configureTravelMachine } from "../src/lib/portability/travel-machine";
import { acquireWriterAuthority, assertWriterAuthority, readWriterAuthority } from "../src/lib/portability/writer-authority";
import { VideoQueueEngine } from "../src/lib/video-queue/engine";
import { emptyVideoQueueStore, saveVideoQueueStore } from "../src/lib/video-queue/runtime";
import { saveWorkflow } from "../src/lib/workflows/runtime";

const startedAt = new Date();
const at = (days: number, minutes = 0) => new Date(startedAt.getTime() + (days * 24 * 60 + minutes) * 60_000);

function config(root: string, name: string): PortabilityConfig {
  return {
    enabled: true,
    machineName: name,
    rolePreference: "writer",
    statePath: path.join(root, "state"),
    backupPath: path.join(root, "backups"),
    oneDriveRoot: path.join(root, "OneDrive"),
    stabilityWindowSeconds: 0,
    writerLeaseMinutes: 1_440,
    backupRetentionCount: 10,
  };
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tubeknowledge-travel-e2e-"));
  try {
    const towerRoot = path.join(root, "Tower");
    const portableRoot = path.join(root, "Portable");
    const towerVault = path.join(towerRoot, "OneDrive", "projet_youtube");
    const portableVault = path.join(portableRoot, "OneDrive", "projet_youtube");
    const towerRuntime = path.join(towerRoot, "runtime");
    const portableRuntime = path.join(portableRoot, "runtime");
    const portableSessions = path.join(portableRoot, "sessions");
    const towerSessions = path.join(towerRoot, "sessions");
    await mkdir(path.join(towerVault, "02_SOURCES"), { recursive: true });
    await writeFile(path.join(towerVault, "INDEX.md"), "# Vault de simulation\n", "utf8");
    await writeFile(path.join(towerVault, "02_SOURCES", "videos.md"), "# Vidéos\n", "utf8");

    const towerConfig = config(towerRoot, "Tour fixture");
    const tower = await ensureMachineIdentity(towerConfig, { displayName: "Tour fixture", rolePreference: "writer", machineId: "11111111-1111-4111-8111-111111111111", now: at(0) });
    const initialSnapshot = await createStableSnapshot(towerVault, tower.machineId, 0, { now: at(0), wait: async () => undefined, attributeProbe: async () => ({ offline: false, unpinned: false, reparsePoint: false }) });
    const backup = await createPortabilityBackup(towerVault, towerConfig, tower, "knowledge", { trigger: "manual-check", now: at(0) });
    await verifyPortabilityBackup(towerConfig, backup.backupId);
    const checkpoint = await createCheckpoint(towerVault, initialSnapshot, "backup", { now: at(0), backupId: backup.backupId });
    await acquireWriterAuthority(towerVault, tower, checkpoint, 1_440, { now: at(0), force: true, verifiedBackupId: backup.backupId, confirmationText: "REPRENDRE" });
    await saveOperationSettings(towerConfig, { singleMachineMode: true, renewalReminderMinutes: 10 }, at(0));

    const queueRoot = path.join(towerRuntime, "video-queue");
    const workflowRoot = path.join(towerRuntime, "video-knowledge-workflows");
    const acquisitionId = "22222222-2222-4222-8222-222222222222";
    const workflowId = "33333333-3333-4333-8333-333333333333";
    const itemId = "44444444-4444-4444-8444-444444444444";
    await saveVideoQueueStore({
      ...emptyVideoQueueStore(),
      items: [{ itemId, createdAt: at(0).toISOString(), updatedAt: at(0).toISOString(), canonicalUrl: "https://www.youtube.com/watch?v=fixture1234", videoId: "fixture1234", state: "paused", workflowId, pauseReason: "source-selection-required", resumeState: "transcribing", attemptCount: 1 }],
    }, queueRoot);
    await saveWorkflow({ schemaVersion: 1, workflowId, createdAt: at(0).toISOString(), updatedAt: at(0).toISOString(), state: "source-selection", sourceUrl: "https://www.youtube.com/watch?v=fixture1234", videoId: "fixture1234", acquisitionId, nextAction: "Choisir la transcription", reprocessingApproved: false, knowledgePaths: [] }, workflowRoot);
    await mkdir(path.join(towerRuntime, "acquisitions", acquisitionId, "output"), { recursive: true });
    await writeFile(path.join(towerRuntime, "acquisitions", acquisitionId, "job.json"), JSON.stringify({ id: acquisitionId, status: "waiting-for-selection", artifacts: [{ name: "transcript.txt" }] }), "utf8");
    await writeFile(path.join(towerRuntime, "acquisitions", acquisitionId, "output", "transcript.txt"), "Transcript fixture lisible.\n", "utf8");
    await mkdir(path.join(towerRuntime, "chatgpt-packages", "55555555-5555-4555-8555-555555555555"), { recursive: true });
    await writeFile(path.join(towerRuntime, "chatgpt-packages", "55555555-5555-4555-8555-555555555555", "status.json"), "{}\n", "utf8");

    const output = path.join(root, "cold-output");
    const fixtureEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      YOUTUBE_LIBRARY_PATH: towerVault,
      TUBEKNOWLEDGE_RUNTIME_PATH: towerRuntime,
      TUBEKNOWLEDGE_IMPORT_SESSION_PATH: towerSessions,
      TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: towerConfig.statePath,
      TUBEKNOWLEDGE_BACKUP_PATH: towerConfig.backupPath,
      TUBEKNOWLEDGE_ONEDRIVE_ROOT: towerConfig.oneDriveRoot,
      TUBEKNOWLEDGE_MACHINE_NAME: tower.displayName,
      TUBEKNOWLEDGE_MACHINE_ROLE: "writer",
      TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0",
      TUBEKNOWLEDGE_WRITER_LEASE_MINUTES: "1440",
    };
    execFileSync("powershell", ["-ExecutionPolicy", "Bypass", "-File", "scripts/prepare-travel-portability.ps1", "-Mode", "Prepare", "-OutputDirectory", output, "-DurationDays", "45", "-Confirmation", "PREPARER ABSENCE", "-FinalConfirmation", "LIBERER LA TOUR", "-Fixture"], { cwd: process.cwd(), env: fixtureEnvironment, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const outputNames = await (await import("node:fs/promises")).readdir(output);
    const receiptName = outputNames.find((name) => name.endsWith(".receipt.json"));
    const archiveName = outputNames.find((name) => name.endsWith(".zip"));
    if (!receiptName || !archiveName) throw new Error("Prepare fixture n’a pas produit le bundle et son reçu.");
    const receipt = JSON.parse(await readFile(path.join(output, receiptName), "utf8")) as { handoffId: string };
    const coldArchive = await readFile(path.join(output, archiveName));
    const cold = await parseMigrationArchive(coldArchive);
    const handoff = await readExtendedAbsenceHandoff(towerVault, receipt.handoffId);
    if ((await readWriterAuthority(towerVault))?.status !== "released") throw new Error("La Tour fixture n’a pas libéré writer.");
    await expectWriterRejected(towerVault, tower, at(0, 16));

    await mkdir(path.dirname(portableVault), { recursive: true });
    await cp(towerVault, portableVault, { recursive: true, force: false, errorOnExist: true });
    const portableConfig = { ...config(portableRoot, "Portable fixture"), rolePreference: "reader" as const };
    const configured = await configureTravelMachine(portableConfig, "Portable fixture");
    const portable = configured.identity;
    if (portable.rolePreference !== "reader") throw new Error("Le Portable fixture n’a pas été configuré reader avant handoff.");
    if (portable.machineId === tower.machineId) throw new Error("Les identités fixture ne sont pas distinctes.");
    const preview = await previewColdMigrationImport(coldArchive, { runtimePath: portableRuntime, sessionPath: portableSessions, backupPath: portableConfig.backupPath });
    if (!preview.canImport || !preview.targetEmpty) throw new Error("Le runtime Portable fixture n’est pas importable proprement.");
    await importColdMigrationBundle(coldArchive, { runtimePath: portableRuntime, sessionPath: portableSessions, backupPath: portableConfig.backupPath, vaultPath: portableVault, now: at(30) });
    const portableSnapshot = await createStableSnapshot(portableVault, portable.machineId, 0, { now: at(30), wait: async () => undefined, attributeProbe: async () => ({ offline: false, unpinned: false, reparsePoint: false }) });
    if (portableSnapshot.rootHash !== handoff.rootHash) throw new Error("Le rootHash Portable fixture diffère.");
    const accepted = await acceptExtendedAbsenceHandoff(portableVault, handoff.handoffId, portable, portableSnapshot, portableConfig, { now: at(30), confirmationText: "ACCEPTER ABSENCE" });
    if (accepted.authority.machineId !== portable.machineId) throw new Error("Writer Portable fixture absent.");
    const environment = {
      YOUTUBE_LIBRARY_PATH: portableVault,
      TUBEKNOWLEDGE_RUNTIME_PATH: portableRuntime,
      TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: portableConfig.statePath,
      TUBEKNOWLEDGE_BACKUP_PATH: portableConfig.backupPath,
      TUBEKNOWLEDGE_ONEDRIVE_ROOT: portableConfig.oneDriveRoot,
      TUBEKNOWLEDGE_MACHINE_NAME: portable.displayName,
      TUBEKNOWLEDGE_MACHINE_ROLE: "reader",
      TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0",
      TUBEKNOWLEDGE_WRITER_LEASE_MINUTES: "1440",
    };
    const status = await getPortabilityStatus(environment, at(30));
    if (status.writer.state !== "active-local" || !status.writer.canWrite) throw new Error("Diagnostic Portable fixture non writer.");

    const restartedQueue = await new VideoQueueEngine({ root: path.join(portableRuntime, "video-queue"), autoProcess: false }).snapshot();
    const restartedWorkflow = JSON.parse(await readFile(path.join(portableRuntime, "video-knowledge-workflows", `${workflowId}.json`), "utf8")) as { state?: string };
    const restartedTranscript = await readFile(path.join(portableRuntime, "acquisitions", acquisitionId, "output", "transcript.txt"), "utf8");
    if (restartedQueue.items[0]?.workflowId !== workflowId || restartedWorkflow.state !== "source-selection" || !restartedTranscript.includes("lisible")) throw new Error("La reprise après redémarrage fixture est incomplète.");

    console.log(JSON.stringify({
      verdict: "GO_FIXTURE_J_PLUS_30",
      truePortableTested: false,
      simulatedSyncOnly: true,
      machineIdsDistinct: true,
      rootHashUnchanged: true,
      towerWriter: false,
      portableWriter: true,
      queueVisibleAfterRestart: true,
      workflowsVisibleAfterRestart: true,
      prepareWrapperExecutedOnFixture: true,
      bundleFiles: cold.manifest.fileCount,
    }, null, 2));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function expectWriterRejected(vaultPath: string, identity: Awaited<ReturnType<typeof ensureMachineIdentity>>, now: Date): Promise<void> {
  try { await assertWriterAuthority(vaultPath, identity, now); }
  catch { return; }
  throw new Error("La Tour fixture conserve une autorité writer inattendue.");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Simulation de voyage échouée.");
  process.exitCode = 1;
});
