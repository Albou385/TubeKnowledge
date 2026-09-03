import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPortabilityBackup } from "./backup-builder";
import { listBackupRecords, verifyPortabilityBackup } from "./backup-reader";
import { readBackupZip } from "./backup-zip";
import { createCheckpoint } from "./checkpoints";
import { getPortabilityConfig } from "./config";
import { ensureMachineIdentity } from "./machine-identity";
import { applyRestore } from "./restore-apply";
import { previewRestore } from "./restore-preview";
import { deleteBackupExplicitly } from "./retention";
import { createVaultSnapshot } from "./snapshots";
import { acquireWriterAuthority } from "./writer-authority";

vi.mock("./one-drive", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./one-drive")>();
  const hydratedProbe = async () => ({ offline: false, unpinned: false });
  return {
    ...actual,
    probeWindowsAttributes: hydratedProbe,
    inspectOneDriveLocal: (...args: Parameters<typeof actual.inspectOneDriveLocal>) =>
      actual.inspectOneDriveLocal(args[0], args[1], args[2], args[3] ?? hydratedProbe),
  };
});

const roots: string[] = [];
async function fixture() { const root = await mkdtemp(path.join(os.tmpdir(), "tk-p6-backup-")); roots.push(root); const oneDrive = path.join(root, "OneDrive"); const vault = path.join(oneDrive, "vault"); await mkdir(path.join(vault, "00_SYSTEME"), { recursive: true }); await mkdir(path.join(vault, "01_BIBLIOTHEQUE")); await mkdir(path.join(vault, "02_SOURCES")); await mkdir(path.join(vault, "03_A_TRAITER")); await mkdir(path.join(vault, ".obsidian")); await writeFile(path.join(vault, "INDEX.md"), "# Index\n"); await writeFile(path.join(vault, "00_SYSTEME", "TAXONOMY.md"), "# Taxonomie\n"); await writeFile(path.join(vault, "01_BIBLIOTHEQUE", "note.md"), "# Original\n"); await writeFile(path.join(vault, "02_SOURCES", "videos.md"), "# Videos\n"); await writeFile(path.join(vault, ".obsidian", "appearance.json"), "{}"); await writeFile(path.join(vault, ".obsidian", "workspace.json"), "secret-local"); const env = { YOUTUBE_LIBRARY_PATH: vault, TUBEKNOWLEDGE_ONEDRIVE_ROOT: oneDrive, TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(root, "state"), TUBEKNOWLEDGE_BACKUP_PATH: path.join(root, "backups"), TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0", TUBEKNOWLEDGE_MACHINE_NAME: "Tour", TUBEKNOWLEDGE_MACHINE_ROLE: "writer" }; const config = getPortabilityConfig(env); const identity = await ensureMachineIdentity(config, { machineId: "11111111-1111-4111-8111-111111111111" }); return { root, oneDrive, vault, env, config, identity }; }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("Backup V1, rétention et restauration", () => {
  it("crée une racine unique, manifeste/hashes et profils knowledge/full vérifiés", async () => { const f = await fixture(); const knowledge = await createPortabilityBackup(f.vault, f.config, f.identity, "knowledge", { gitCommit: "abcdef0" }); const verified = await verifyPortabilityBackup(f.config, knowledge.backupId); expect(verified.record.manifest.files.map((file) => file.path)).not.toContain(".obsidian/appearance.json"); const entries = await readBackupZip(await readFile(knowledge.zipPath)); expect(entries.has("backup-manifest.json")).toBe(true); expect(entries.has("metadata/validation.json")).toBe(true); const full = await createPortabilityBackup(f.vault, f.config, f.identity, "full", { gitCommit: "abcdef0" }); const fullFiles = (await verifyPortabilityBackup(f.config, full.backupId)).record.manifest.files.map((file) => file.path); expect(fullFiles).toContain(".obsidian/appearance.json"); expect(fullFiles).not.toContain(".obsidian/workspace.json"); });
  it("refuse un backup corrompu et protège le dernier vérifié", async () => { const f = await fixture(); const backup = await createPortabilityBackup(f.vault, f.config, f.identity); await writeFile(backup.zipPath, Buffer.from("corrompu")); await expect(verifyPortabilityBackup(f.config, backup.backupId)).rejects.toThrow("BACKUP_INVALID"); await expect(deleteBackupExplicitly(f.config, backup.backupId, false)).rejects.toThrow("Confirmation"); });
  it("restaure vers staging sans modifier le vault ni supprimer les extras", async () => { const f = await fixture(); const backup = await createPortabilityBackup(f.vault, f.config, f.identity); const staging = path.join(f.root, "staging"); await mkdir(staging); await writeFile(path.join(staging, "extra.md"), "extra"); const preview = await previewRestore(f.config, { backupId: backup.backupId, mode: "restore-to-staging", targetRoot: staging }); expect(preview.operations.map((item) => item.type)).toContain("delete-candidate"); const before = await readFile(path.join(f.vault, "INDEX.md"), "utf8"); const result = await applyRestore(f.config, f.env, { restoreId: preview.restoreId, confirmed: true }); expect(result.status).toBe("success"); expect(await readFile(path.join(staging, "extra.md"), "utf8")).toBe("extra"); expect(await readFile(path.join(f.vault, "INDEX.md"), "utf8")).toBe(before); });
  it("exige writer/RESTAURER, crée un backup pré-restore et rollback sans succès partiel", async () => { const f = await fixture(); const source = await createPortabilityBackup(f.vault, f.config, f.identity); const snapshot = await createVaultSnapshot(f.vault, f.identity.machineId); const checkpoint = await createCheckpoint(f.vault, snapshot, "backup"); await acquireWriterAuthority(f.vault, f.identity, checkpoint, 30, { force: true, verifiedBackupId: source.backupId, confirmationText: "REPRENDRE" }); await writeFile(path.join(f.vault, "01_BIBLIOTHEQUE", "note.md"), "# Divergent\n"); const divergent = await createVaultSnapshot(f.vault, f.identity.machineId); const divergentCheckpoint = await createCheckpoint(f.vault, divergent, "backup"); const { advanceWriterCheckpoint } = await import("./writer-authority"); await advanceWriterCheckpoint(f.vault, f.identity, divergentCheckpoint.checkpointId); const preview = await previewRestore(f.config, { backupId: source.backupId, mode: "restore-in-place", targetRoot: f.vault }); await expect(applyRestore(f.config, f.env, { restoreId: preview.restoreId, confirmed: true })).rejects.toMatchObject({ code: "RESTORE_CONFIRMATION_REQUIRED" }); const preview2 = await previewRestore(f.config, { backupId: source.backupId, mode: "restore-in-place", targetRoot: f.vault }); const rolled = await applyRestore(f.config, f.env, { restoreId: preview2.restoreId, confirmed: true, confirmationText: "RESTAURER" }, { failAfterOperations: 1, wait: async () => undefined }); expect(rolled.status).toBe("rolled-back"); expect(await readFile(path.join(f.vault, "01_BIBLIOTHEQUE", "note.md"), "utf8")).toBe("# Divergent\n"); expect(rolled.preRestoreBackupId).toBeTruthy(); expect((await listBackupRecords(f.config)).length).toBeGreaterThanOrEqual(2); });
});

