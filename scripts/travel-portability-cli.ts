import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

import { parseLibraryConfig } from "../src/lib/config/library-config";
import { sha256 } from "../src/lib/imports/hash";
import { listBackupRecords, verifyPortabilityBackup } from "../src/lib/portability/backup-reader";
import { createPortabilityBackup } from "../src/lib/portability/backup-builder";
import { latestCheckpoint } from "../src/lib/portability/checkpoints";
import { getPortabilityConfig } from "../src/lib/portability/config";
import { isBlockingKnowledgeConflict, loadConflicts } from "../src/lib/portability/conflicts";
import { loadMachineIdentity } from "../src/lib/portability/machine-identity";
import {
  exportColdMigrationBundle,
  importColdMigrationBundle,
  previewColdMigrationImport,
} from "../src/lib/portability/migration";
import { loadOperationSettings, saveOperationSettings } from "../src/lib/portability/operation-settings";
import { atomicWriteJson } from "../src/lib/portability/filesystem";
import { inspectPortabilityReadiness } from "../src/lib/portability/readiness";
import { createStableSnapshot } from "../src/lib/portability/snapshots";
import { assertGitReadyForTravel, assertTravelRemoteMatchesHead, TRAVEL_PREPARE_BRANCH, TRAVEL_PREPARE_UPSTREAM } from "../src/lib/portability/travel-git";
import { acceptExtendedAbsenceHandoff, prepareExtendedAbsenceHandoff } from "../src/lib/portability/travel-handoff";
import { configureTravelMachine } from "../src/lib/portability/travel-machine";
import { isAuthorityActive, readWriterAuthority } from "../src/lib/portability/writer-authority";
import { getRuntimeLocation } from "../src/lib/transcription/runtime-location";

function value(name: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Argument requis : ${name}`);
  return process.argv[index + 1];
}

function optionalValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function currentCommit(): string { return git(["rev-parse", "HEAD"]); }

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertFixturePreparePaths(input: { vaultPath: string; runtimePath: string; sessionPath: string; statePath: string; backupPath: string; outputPath: string }): void {
  if (process.env.NODE_ENV !== "test") throw new Error("Le mode Fixture exige NODE_ENV=test.");
  const temporaryRoot = os.tmpdir();
  for (const localPath of Object.values(input)) {
    if (!isInside(temporaryRoot, localPath)) throw new Error("Le mode Fixture est limité à des chemins sous le dossier temporaire système.");
  }
}

async function freeBytes(target: string): Promise<number | null> {
  try {
    const root = path.parse(path.resolve(target)).root;
    return (await statfs(root)).bavail * (await statfs(root)).bsize;
  } catch { return null; }
}

async function statfs(target: string) {
  const fs = await import("node:fs/promises");
  return fs.statfs(target);
}

async function audit() {
  const config = getPortabilityConfig();
  const library = parseLibraryConfig();
  const identity = await loadMachineIdentity(config);
  const runtime = getRuntimeLocation();
  const checks: Array<{ code: string; status: "PASS" | "WARN" | "FAIL"; message: string }> = [];
  let snapshotRootHash: string | null = null;
  let readinessStatus: string | null = null;
  let writerState: string | null = null;
  const add = (status: "PASS" | "WARN" | "FAIL", code: string, message: string) => checks.push({ status, code, message });
  try {
    const root = git(["rev-parse", "--show-toplevel"]);
    const branch = git(["branch", "--show-current"]);
    const status = git(["status", "--porcelain=v1"]);
    const remote = git(["remote", "get-url", "origin"]);
    add(path.resolve(root) === path.resolve(process.cwd()) ? "PASS" : "FAIL", "GIT_ROOT", "La racine Git correspond au projet attendu.");
    add(branch === TRAVEL_PREPARE_BRANCH ? "PASS" : "FAIL", "GIT_BRANCH", branch === TRAVEL_PREPARE_BRANCH ? "La branche main requise pour Prepare est active." : "La branche main requise pour Prepare n’est pas active.");
    add(status ? "FAIL" : "PASS", "GIT_STATUS", status ? "Le dépôt contient des changements locaux." : "Le dépôt est propre.");
    add(remote ? "PASS" : "FAIL", "GIT_REMOTE", remote ? "Le remote origin est configuré." : "Le remote origin est absent.");
    try {
      const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
      if (upstream !== TRAVEL_PREPARE_UPSTREAM) {
        add("FAIL", "GIT_UPSTREAM", `L’upstream requis est ${TRAVEL_PREPARE_UPSTREAM}.`);
      } else {
        const [behind, ahead] = git(["rev-list", "--left-right", "--count", `${TRAVEL_PREPARE_UPSTREAM}...HEAD`]).split(/\s+/).map(Number);
        if (behind === 0 && ahead === 0) {
          assertTravelRemoteMatchesHead(git);
          add("PASS", "GIT_UPSTREAM", "main local correspond à origin/main local et distant.");
        } else {
          add("FAIL", "GIT_UPSTREAM", `main local et origin/main divergent (behind=${behind}, ahead=${ahead}).`);
        }
      }
    } catch (error) { add("FAIL", "GIT_UPSTREAM", error instanceof Error ? error.message : "main n’a pas origin/main comme upstream vérifiable."); }
  } catch { add("FAIL", "GIT", "Git ou le dépôt est indisponible."); }
  if (!config.enabled || !library.ok || !identity) {
    add("FAIL", "PORTABILITY_CONFIG", "La portabilité, le vault ou l’identité locale est incomplet.");
  } else {
    const [readiness, authority, checkpoint, conflicts, backups, settings] = await Promise.all([
      inspectPortabilityReadiness(library.rootPath, config, identity),
      readWriterAuthority(library.rootPath),
      latestCheckpoint(library.rootPath),
      loadConflicts(config),
      listBackupRecords(config),
      loadOperationSettings(config),
    ]);
    readinessStatus = readiness.status;
    add(readiness.status === "ready-local" ? "PASS" : "FAIL", "VAULT_READY", readiness.status === "ready-local" ? "Le vault est présent, hydraté et lisible localement." : "Le vault n’est pas prêt localement.");
    add("WARN", "ONEDRIVE_CLOUD", "L’état local est observable, mais la synchronisation cloud ne peut pas être certifiée.");
    try {
      const snapshot = await createStableSnapshot(library.rootPath, identity.machineId, config.stabilityWindowSeconds);
      snapshotRootHash = snapshot.rootHash;
      add(checkpoint?.rootHash === snapshot.rootHash ? "PASS" : "FAIL", "CHECKPOINT", checkpoint?.rootHash === snapshot.rootHash ? "Le snapshot stable correspond au dernier checkpoint." : "Le checkpoint ne correspond pas au snapshot stable.");
    } catch { add("FAIL", "STABLE_SNAPSHOT", "Le snapshot local stable n’a pas pu être confirmé."); }
    const blocking = conflicts.filter(isBlockingKnowledgeConflict).length;
    add(blocking === 0 ? "PASS" : "FAIL", "CONFLICTS", blocking === 0 ? "Aucun conflit de connaissance bloquant n’est enregistré." : "Un conflit de connaissance bloque la préparation.");
    writerState = !authority ? "absent" : authority.status === "released" ? "released" : isAuthorityActive(authority) ? authority.machineId === identity.machineId ? "active-local" : "active-remote" : authority.machineId === identity.machineId ? "expired-local" : "expired-remote";
    add(writerState === "active-local" ? "PASS" : "FAIL", "WRITER", writerState === "active-local" ? "La Tour possède actuellement writer." : "La Tour ne possède pas un writer local actif.");
    add(settings.singleMachineMode ? "WARN" : "PASS", "SINGLE_MACHINE_MODE", settings.singleMachineMode ? "Le mode mono-machine devra être désactivé par Prepare." : "Le mode mono-machine est déjà désactivé.");
    const matchingBackup = snapshotRootHash ? backups.find((item) => item.verified && item.manifest.sourceRootHash === snapshotRootHash) : undefined;
    add(matchingBackup ? "PASS" : "WARN", "BACKUP", matchingBackup ? "Un backup vérifié correspond au snapshot courant." : "Prepare devra créer et vérifier un nouveau backup.");
  }
  const runtimeExists = await stat(runtime.runtimePath).then((details) => details.isDirectory()).catch(() => false);
  add(runtimeExists ? "PASS" : "WARN", "RUNTIME", runtimeExists ? "Le runtime local existe et peut être exporté." : "Le runtime local est absent ou vide.");
  const available = await freeBytes(runtime.runtimePath);
  add(available === null ? "WARN" : available >= 2 * 1024 * 1024 * 1024 ? "PASS" : "FAIL", "DISK_SPACE", available === null ? "L’espace disque libre n’a pas pu être mesuré." : available >= 2 * 1024 * 1024 * 1024 ? "Au moins 2 GiB sont libres sur le volume local." : "Moins de 2 GiB sont libres sur le volume local.");
  const noGo = checks.some((check) => check.status === "FAIL");
  console.log(JSON.stringify({ schemaVersion: 1, mode: "Audit", readOnly: true, verdict: noGo ? "NO-GO" : "GO", snapshotRootHash, readinessStatus, writerState, checks }, null, 2));
  if (noGo) process.exitCode = 2;
}

async function writeBundle(outputDirectory: string, archive: Buffer, manifest: object, bundleId: string): Promise<{ archiveName: string; sha256: string }> {
  if (!path.isAbsolute(outputDirectory)) throw new Error("Le dossier de sortie doit être absolu.");
  await mkdir(outputDirectory, { recursive: true });
  const archiveName = `tubeknowledge-travel-${bundleId}.zip`;
  const archivePath = path.join(outputDirectory, archiveName);
  const hash = sha256(archive);
  await writeFile(archivePath, archive, { flag: "wx", mode: 0o600 });
  await writeFile(`${archivePath}.sha256`, `${hash}  ${archiveName}\n`, { flag: "wx", mode: 0o600 });
  await writeFile(`${archivePath}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  if (sha256(await readFile(archivePath)) !== hash) throw new Error("La vérification du bundle écrit a échoué.");
  return { archiveName, sha256: hash };
}

async function exportBundle() {
  const sourceRootHash = value("--root-hash");
  const outputDirectory = value("--output");
  const backupId = optionalValue("--backup-id");
  const backupZipPath = optionalValue("--backup-zip");
  const result = await exportColdMigrationBundle({ sourceRootHash, gitCommit: currentCommit(), backupId, backupZipPath });
  const written = await writeBundle(outputDirectory, result.archive, result.manifest, result.manifest.bundleId);
  console.log(JSON.stringify({ bundleId: result.manifest.bundleId, fileCount: result.manifest.fileCount, totalBytes: result.manifest.totalBytes, ...written }, null, 2));
}

async function prepare() {
  if (value("--confirmation") !== "PREPARER ABSENCE") throw new Error("Confirmation PREPARER ABSENCE requise.");
  if (value("--final-confirmation") !== "LIBERER LA TOUR") throw new Error("Confirmation finale LIBERER LA TOUR requise.");
  const durationDays = Number(optionalValue("--days") ?? "45");
  const outputDirectory = value("--output");
  const config = getPortabilityConfig();
  const library = parseLibraryConfig();
  const identity = await loadMachineIdentity(config);
  if (!config.enabled || !library.ok || !identity) throw new Error("Configuration de portabilité incomplète.");
  if (process.argv.includes("--fixture")) {
    assertFixturePreparePaths({ vaultPath: library.rootPath, runtimePath: getRuntimeLocation().runtimePath, sessionPath: defaultSessionRootForCli(), statePath: config.statePath, backupPath: config.backupPath, outputPath: outputDirectory });
  } else assertGitReadyForTravel(process.cwd());
  const readiness = await inspectPortabilityReadiness(library.rootPath, config, identity);
  if (readiness.status !== "ready-local") throw new Error("Le vault local n’est pas prêt.");
  const conflicts = await loadConflicts(config);
  const blockingConflicts = conflicts.filter(isBlockingKnowledgeConflict).length;
  if (blockingConflicts) throw new Error("Des conflits bloquent la préparation.");
  const snapshot = await createStableSnapshot(library.rootPath, identity.machineId, config.stabilityWindowSeconds);
  const checkpoint = await latestCheckpoint(library.rootPath);
  if (!checkpoint || checkpoint.rootHash !== snapshot.rootHash) throw new Error("Le checkpoint ne correspond pas au snapshot stable.");
  const backup = await createPortabilityBackup(library.rootPath, config, identity, "knowledge", { trigger: "manual" });
  const verified = await verifyPortabilityBackup(config, backup.backupId);
  if (verified.record.manifest.sourceRootHash !== snapshot.rootHash) throw new Error("Le backup vérifié ne correspond pas au snapshot stable.");
  const migration = await exportColdMigrationBundle({
    sourceRootHash: snapshot.rootHash,
    gitCommit: currentCommit(),
    backupId: verified.record.backupId,
    backupZipPath: verified.record.zipPath,
  });
  const written = await writeBundle(outputDirectory, migration.archive, migration.manifest, migration.manifest.bundleId);
  const settings = await loadOperationSettings(config);
  await saveOperationSettings(config, { singleMachineMode: false, renewalReminderMinutes: settings.renewalReminderMinutes });
  const handoff = await prepareExtendedAbsenceHandoff(library.rootPath, identity, snapshot, checkpoint, verified.record, {
    durationDays,
    blockingConflicts,
    placeholderCount: readiness.placeholders.length,
    singleMachineMode: false,
  });
  const receiptName = `tubeknowledge-travel-${migration.manifest.bundleId}.receipt.json`;
  let receiptWritten = true;
  try {
    await atomicWriteJson(path.join(outputDirectory, receiptName), {
      schemaVersion: 1,
      status: "prepared",
      bundleId: migration.manifest.bundleId,
      bundleSha256: written.sha256,
      handoffId: handoff.handoffId,
      sourceRootHash: handoff.rootHash,
      createdAt: handoff.createdAt,
      expiresAt: handoff.expiresAt,
      durationDays: handoff.durationDays,
    }, true);
  } catch { receiptWritten = false; }
  console.log(JSON.stringify({ verdict: "PREPARED", backupId: backup.backupId, bundleId: migration.manifest.bundleId, archiveName: written.archiveName, receiptName: receiptWritten ? receiptName : null, receiptWritten, handoffId: handoff.handoffId, expiresAt: handoff.expiresAt, writerReleased: true, warning: "NE PLUS ÉCRIRE DEPUIS LA TOUR" }, null, 2));
}

function defaultSessionRootForCli(): string {
  return process.env.TUBEKNOWLEDGE_IMPORT_SESSION_PATH || path.join(os.tmpdir(), "tubeknowledge-import-sessions");
}

async function previewImport() {
  const archive = await readFile(value("--archive"));
  const result = await previewColdMigrationImport(archive, { runtimePath: value("--runtime"), sessionPath: value("--sessions"), backupPath: value("--backups") });
  console.log(JSON.stringify(result, null, 2));
}

async function applyImport() {
  const archive = await readFile(value("--archive"));
  const result = await importColdMigrationBundle(archive, {
    runtimePath: value("--runtime"),
    sessionPath: value("--sessions"),
    backupPath: value("--backups"),
    vaultPath: value("--vault"),
    confirmationText: optionalValue("--confirmation"),
  });
  console.log(JSON.stringify({ ...result, targetBackupPath: result.targetBackupPath ? path.basename(result.targetBackupPath) : null }, null, 2));
}

async function accept() {
  if (value("--confirmation") !== "ACCEPTER ABSENCE") throw new Error("Confirmation ACCEPTER ABSENCE requise.");
  const config = getPortabilityConfig();
  const library = parseLibraryConfig();
  const identity = await loadMachineIdentity(config);
  if (!config.enabled || !library.ok || !identity) throw new Error("Configuration Portable incomplète.");
  const readiness = await inspectPortabilityReadiness(library.rootPath, config, identity);
  const conflicts = await loadConflicts(config);
  const snapshot = await createStableSnapshot(library.rootPath, identity.machineId, config.stabilityWindowSeconds);
  const accepted = await acceptExtendedAbsenceHandoff(library.rootPath, value("--handoff"), identity, snapshot, config, {
    blockingConflicts: conflicts.filter(isBlockingKnowledgeConflict).length,
    placeholderCount: readiness.placeholders.length,
    confirmationText: "ACCEPTER ABSENCE",
  });
  console.log(JSON.stringify({ handoffId: accepted.handoff.handoffId, writerActive: true, idempotent: accepted.idempotent, machineDistinct: accepted.handoff.sourceMachineId !== identity.machineId }, null, 2));
}

async function configureMachine() {
  const config = getPortabilityConfig();
  const result = await configureTravelMachine(config, value("--name"));
  console.log(JSON.stringify({ configured: true, created: result.created, displayName: result.identity.displayName, rolePreference: result.identity.rolePreference }, null, 2));
}

async function main() {
  loadEnvConfig(process.cwd());
  const action = process.argv[2];
  if (action === "audit") return audit();
  if (action === "export") return exportBundle();
  if (action === "prepare") return prepare();
  if (action === "preview-import") return previewImport();
  if (action === "import") return applyImport();
  if (action === "configure-machine") return configureMachine();
  if (action === "accept") return accept();
  throw new Error("Action de voyage inconnue.");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Opération de voyage échouée.");
  process.exitCode = 1;
});
