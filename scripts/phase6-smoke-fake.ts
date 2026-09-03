import { createHash, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { applyImport } from "../src/lib/imports/apply";
import { createPortabilityBackup } from "../src/lib/portability/backup-builder";
import { verifyPortabilityBackup } from "../src/lib/portability/backup-reader";
import { bootstrapWriter } from "../src/lib/portability/bootstrap-writer";
import { checkpointDirectory, latestCheckpoint } from "../src/lib/portability/checkpoints";
import { getPortabilityConfig } from "../src/lib/portability/config";
import { detectConflicts, previewConflictResolution } from "../src/lib/portability/conflicts";
import { acceptHandoff, prepareHandoff } from "../src/lib/portability/handoff";
import { readPortabilityHistory } from "../src/lib/portability/history";
import { ensureMachineIdentity } from "../src/lib/portability/machine-identity";
import { applyRestore } from "../src/lib/portability/restore-apply";
import { previewRestore } from "../src/lib/portability/restore-preview";
import { createStableSnapshot, createVaultSnapshot } from "../src/lib/portability/snapshots";
import { acquireWriterAuthority, readWriterAuthority } from "../src/lib/portability/writer-authority";
import { reacquireWriter, renewWriter } from "../src/lib/portability/writer-operations";

async function fingerprint(root: string | undefined): Promise<string | null> { if (!root) return null; const hash = createHash("sha256"); async function visit(directory: string) { for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) { const target = path.join(directory, entry.name); if (entry.isSymbolicLink()) continue; hash.update(path.relative(root!, target)); if (entry.isDirectory()) await visit(target); else if (entry.isFile()) hash.update(await readFile(target)); } } await visit(root); return hash.digest("hex"); }

async function main() {
  loadEnvConfig(process.cwd()); const trueBefore = await fingerprint(process.env.YOUTUBE_LIBRARY_PATH); const root = await mkdtemp(path.join(os.tmpdir(), "tk-phase6-smoke-")); const oneDrive = path.join(root, "OneDrive"); const vault = path.join(oneDrive, "vault"); const staging = path.join(root, "staging"); const sessions = path.join(root, "import-sessions");
  try {
    await mkdir(path.join(vault, "01_BIBLIOTHEQUE", "Test"), { recursive: true }); await mkdir(path.join(vault, "00_SYSTEME")); await mkdir(path.join(vault, "02_SOURCES")); await mkdir(path.join(vault, "03_A_TRAITER"));
    await writeFile(path.join(vault, "INDEX.md"), "# Index factice\n"); await writeFile(path.join(vault, "00_SYSTEME", "TAXONOMY.md"), "# Taxonomie\n"); await writeFile(path.join(vault, "01_BIBLIOTHEQUE", "Test", "note.md"), "# Note initiale\n"); await writeFile(path.join(vault, "02_SOURCES", "videos.md"), "# Videos\n");
    const envA = { YOUTUBE_LIBRARY_PATH: vault, TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(root, "tour-state"), TUBEKNOWLEDGE_BACKUP_PATH: path.join(root, "tour-backups"), TUBEKNOWLEDGE_ONEDRIVE_ROOT: oneDrive, TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0", TUBEKNOWLEDGE_MACHINE_NAME: "Tour", TUBEKNOWLEDGE_MACHINE_ROLE: "writer" };
    const envB = { ...envA, TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(root, "portable-state"), TUBEKNOWLEDGE_BACKUP_PATH: path.join(root, "portable-backups"), TUBEKNOWLEDGE_MACHINE_NAME: "Portable", TUBEKNOWLEDGE_MACHINE_ROLE: "reader" };
    const configA = getPortabilityConfig(envA); const configB = getPortabilityConfig(envB); const tour = await ensureMachineIdentity(configA); const portable = await ensureMachineIdentity(configB);
    const firstBackup = await createPortabilityBackup(vault, configA, tour); await verifyPortabilityBackup(configA, firstBackup.backupId);
    const bootstrapRequest = { idempotencyKey: randomUUID(), backupId: firstBackup.backupId, confirmationText: "REPRENDRE" as const };
    const timelineStart = new Date(Date.now() - 45 * 60_000);
    const atMinute = (minutes: number) => new Date(timelineStart.getTime() + minutes * 60_000);
    const [initialBootstrap, parallelReplay] = await Promise.all([bootstrapWriter(bootstrapRequest, envA, { now: timelineStart, wait: async () => undefined }), bootstrapWriter(bootstrapRequest, envA, { now: timelineStart, wait: async () => undefined })]);
    const replayBootstrap = await bootstrapWriter(bootstrapRequest, envA, { now: timelineStart, wait: async () => undefined });
    const checkpointFiles = (await readdir(checkpointDirectory(vault))).filter((name) => name.endsWith(".json"));
    const bootstrapEvents = (await readPortabilityHistory(configA.statePath)).filter((entry) => entry.event === "writer-bootstrap");
    const activeAuthority = await readWriterAuthority(vault);
    if (parallelReplay.checkpoint.checkpointId !== initialBootstrap.checkpoint.checkpointId || replayBootstrap.authority.authorityId !== initialBootstrap.authority.authorityId || checkpointFiles.length !== 1 || bootstrapEvents.length !== 1 || activeAuthority?.authorityId !== initialBootstrap.authority.authorityId) throw new Error("Bootstrap writer idempotent invalide.");
    const renewalKey = randomUUID();
    const [renewed, renewalReplay] = await Promise.all([renewWriter(renewalKey, envA, { now: atMinute(5), wait: async () => undefined }), renewWriter(renewalKey, envA, { now: atMinute(5), wait: async () => undefined })]);
    if (renewed.authority.expiresAt !== renewalReplay.authority.expiresAt || renewed.checkpointCreated || (await readdir(checkpointDirectory(vault))).filter((name) => name.endsWith(".json")).length !== 1) throw new Error("Renouvellement idempotent invalide.");
    const reacquireKey = randomUUID();
    const reacquired = await reacquireWriter({ idempotencyKey: reacquireKey, backupId: firstBackup.backupId, confirmationText: "REACQUERIR" }, envA, { now: atMinute(36), wait: async () => undefined });
    const reacquireReplay = await reacquireWriter({ idempotencyKey: reacquireKey, backupId: firstBackup.backupId, confirmationText: "REACQUERIR" }, envA, { now: atMinute(37), wait: async () => undefined });
    if (reacquired.authority.authorityId !== reacquireReplay.authority.authorityId || reacquired.checkpointCreated || (await readdir(checkpointDirectory(vault))).filter((name) => name.endsWith(".json")).length !== 1) throw new Error("Réacquisition idempotente invalide.");
    const beforeTechnical = await createVaultSnapshot(vault, tour.machineId);
    await createPortabilityBackup(vault, configA, tour, "knowledge", { trigger: "manual-check" });
    const afterTechnical = await createVaultSnapshot(vault, tour.machineId);
    const technicalConflicts = await detectConflicts(afterTechnical, configA, initialBootstrap.checkpoint, { baseSnapshot: beforeTechnical, writerAuthority: await readWriterAuthority(vault) });
    if (beforeTechnical.rootHash !== afterTechnical.rootHash || technicalConflicts.length) throw new Error("Métadonnées techniques faussement détectées comme connaissance.");
    const firstSnapshot = await createStableSnapshot(vault, tour.machineId, 0); const firstCheckpoint = initialBootstrap.checkpoint;
    const handoff = await prepareHandoff(vault, tour, firstSnapshot, firstCheckpoint, firstBackup, { now: atMinute(38) }); const portableSnapshot = await createStableSnapshot(vault, portable.machineId, 0); await acceptHandoff(vault, handoff.handoffId, portable, portableSnapshot, configB, { now: atMinute(39), blockingConflicts: 0, placeholderCount: 0 }); await acquireWriterAuthority(vault, portable, firstCheckpoint, 1440, { now: atMinute(40), releasedAuthorityTransfer: { sourceMachineId: handoff.sourceMachineId, targetMachineId: portable.machineId, checkpointId: handoff.checkpointId } });
    await writeFile(path.join(vault, "01_BIBLIOTHEQUE", "Test", "note.md"), "# Version divergente\n"); const divergentSnapshot = await createVaultSnapshot(vault, portable.machineId); const conflicts = await detectConflicts(divergentSnapshot, configB, await latestCheckpoint(vault)); const blocking = conflicts.find((item) => item.type === "checkpoint-mismatch"); if (!blocking) throw new Error("Conflit factice non détecté.");
    const divergentBackup = await createPortabilityBackup(vault, configB, portable); const resolution = await previewConflictResolution({ conflictId: blocking.conflictId, targetPath: "01_BIBLIOTHEQUE/Test/note.md", content: "# Note initiale\n" }, configB, envB, sessions); const applied = await applyImport({ sessionId: resolution.sessionId, confirmed: true, confirmationText: "APPLIQUER" }, { environment: envB, sessionRoot: sessions, now: atMinute(45) }); if (applied.status !== "success") throw new Error("Résolution Phase 3 échouée.");
    const stagingPreview = await previewRestore(configA, { backupId: firstBackup.backupId, mode: "restore-to-staging", targetRoot: staging }); const staged = await applyRestore(configA, envA, { restoreId: stagingPreview.restoreId, confirmed: true }); if (staged.status !== "success") throw new Error("Restore staging échoué.");
    const rollbackPreview = await previewRestore(configB, { backupId: divergentBackup.backupId, mode: "restore-in-place", targetRoot: vault }); const rolledBack = await applyRestore(configB, envB, { restoreId: rollbackPreview.restoreId, confirmed: true, confirmationText: "RESTAURER" }, { failAfterOperations: 1, wait: async () => undefined }); if (rolledBack.status !== "rolled-back") throw new Error("Rollback factice non obtenu.");
    if (await readFile(path.join(vault, "01_BIBLIOTHEQUE", "Test", "note.md"), "utf8") !== "# Note initiale\n") throw new Error("Rollback factice invalide."); const trueAfter = await fingerprint(process.env.YOUTUBE_LIBRARY_PATH); if (trueBefore !== trueAfter) throw new Error("Le vrai vault a changé.");
    console.log("[OK] bootstrap writer initial, replay et double requête parallèle idempotents"); console.log("[OK] renew et reacquire idempotents sans checkpoint supplémentaire"); console.log("[OK] métadonnées techniques modifiées sans conflit de connaissance"); console.log("[OK] handoff Tour -> Portable et Portable writer"); console.log("[OK] conflit Markdown détecté, writer bloqué et résolution via Preview/Apply Phase 3"); console.log("[OK] restore staging et rollback in-place simulé"); console.log("[OK] OneDrive simulé uniquement; vrai vault intact; aucun appel Microsoft");
  } finally { await rm(root, { recursive: true, force: true }); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Smoke Phase 6 échoué."); process.exitCode = 1; });

