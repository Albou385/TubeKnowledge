import { createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parseLibraryConfig } from "../src/lib/config/library-config";
import { createPortabilityBackup } from "../src/lib/portability/backup-builder";
import { verifyPortabilityBackup } from "../src/lib/portability/backup-reader";
import { getPortabilityConfig } from "../src/lib/portability/config";
import { ensureMachineIdentity } from "../src/lib/portability/machine-identity";
import { inspectOneDriveLocal } from "../src/lib/portability/one-drive";
import { applyRestore } from "../src/lib/portability/restore-apply";
import { previewRestore } from "../src/lib/portability/restore-preview";
import { createStableSnapshot } from "../src/lib/portability/snapshots";

async function fingerprint(root: string): Promise<string> { const hash = createHash("sha256"); async function visit(directory: string) { for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) { const target = path.join(directory, entry.name); const stats = await lstat(target); if (stats.isSymbolicLink()) continue; hash.update(path.relative(root, target).split(path.sep).join("/")); if (stats.isDirectory()) await visit(target); else if (stats.isFile()) hash.update(await readFile(target)); } } await visit(root); return hash.digest("hex"); }

async function main() { loadEnvConfig(process.cwd()); const library = parseLibraryConfig(); if (!library.ok) throw new Error(library.message); const before = await fingerprint(library.rootPath); const temp = await mkdtemp(path.join(os.tmpdir(), "tk-phase6-manual-"));
  try { const oneDriveRoot = process.env.TUBEKNOWLEDGE_ONEDRIVE_ROOT || process.env.OneDrive || path.dirname(library.rootPath); const environment = { ...process.env, TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(temp, "state"), TUBEKNOWLEDGE_BACKUP_PATH: path.join(temp, "backups"), TUBEKNOWLEDGE_ONEDRIVE_ROOT: oneDriveRoot, TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "1", TUBEKNOWLEDGE_MACHINE_NAME: "Manual check", TUBEKNOWLEDGE_MACHINE_ROLE: "reader" }; const config = getPortabilityConfig(environment); const identity = await ensureMachineIdentity(config); const diagnostic = await inspectOneDriveLocal(library.rootPath, config, environment); if (!diagnostic.indexReadable) throw new Error("INDEX.md n’est pas disponible localement."); await createStableSnapshot(library.rootPath, identity.machineId, 1); const backup = await createPortabilityBackup(library.rootPath, config, identity); const verified = await verifyPortabilityBackup(config, backup.backupId); const staging = path.join(temp, "staging"); const preview = await previewRestore(config, { backupId: backup.backupId, mode: "restore-to-staging", targetRoot: staging }); const restored = await applyRestore(config, environment, { restoreId: preview.restoreId, confirmed: true }); if (restored.status !== "success") throw new Error("Restore staging échoué."); for (const file of verified.record.manifest.files) { const content = await readFile(path.join(staging, ...file.path.split("/"))); if (createHash("sha256").update(content).digest("hex") !== file.sha256) throw new Error(`Comparaison staging échouée : ${file.path}`); } const after = await fingerprint(library.rootPath); if (before !== after) throw new Error("Le vrai vault a changé pendant le contrôle."); console.log(`[OK] diagnostic local; racine OneDrive probable: ${diagnostic.vaultUnderProbableRoot}`); console.log(`[OK] backup ${backup.backupId} vérifié hors OneDrive`); console.log(`[OK] restore staging comparé: ${verified.record.manifest.fileCount} fichiers`); console.log("[OK] aucun restore in-place, aucun changement writer, vrai vault intact"); console.log("[INFO] Synchronisation cloud non vérifiée; aucun appel Microsoft."); }
  finally { await rm(temp, { recursive: true, force: true }); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Manual-check Phase 6 échoué."); process.exitCode = 1; });

