import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { acquireImportLock } from "@/lib/imports/lock";
import { sha256 } from "@/lib/imports/hash";
import { isInsidePath } from "@/lib/transcription/paths";
import { createPortabilityBackup } from "./backup-builder";
import { verifyPortabilityBackup } from "./backup-reader";
import type { PortabilityConfig } from "./config";
import { PortabilityError } from "./errors";
import { assertConfinedPath, atomicWriteBuffer } from "./filesystem";
import { appendPortabilityHistory } from "./history";
import { recordSuccessfulKnowledgeWrite } from "./integration";
import { loadMachineIdentity } from "./machine-identity";
import { readRestorePreview, restoreSessionPath } from "./restore-preview";
import { assertPortabilityWriteAllowed } from "./safety-gate";

export interface RestoreResult { restoreId: string; status: "success" | "rolled-back" | "rollback-failed"; mode: "restore-to-staging" | "restore-in-place"; preRestoreBackupId?: string; filesCreated: string[]; filesReplaced: string[]; filesArchived: string[] }

function assertStagingDestination(target: string, vault: string, config: PortabilityConfig): void {
  if (isInsidePath(vault, target) || isInsidePath(target, vault)) throw new Error("La restauration staging doit rester séparée du vault actif."); const roots = [config.oneDriveRoot, process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].filter(Boolean) as string[]; if (roots.some((root) => isInsidePath(root, target))) throw new Error("La restauration staging doit rester hors OneDrive.");
}

export async function applyRestore(config: PortabilityConfig, environment: LibraryEnvironment, input: { restoreId: string; confirmed: boolean; confirmationText?: string }, options: { now?: Date; failAfterOperations?: number; failRollback?: boolean; failBaselineWrite?: boolean; wait?: (milliseconds: number) => Promise<void> } = {}): Promise<RestoreResult> {
  const now = options.now || new Date(); const preview = await readRestorePreview(config, input.restoreId, now); const library = parseLibraryConfig(environment); if (!library.ok) throw new PortabilityError("VAULT_UNAVAILABLE"); const { files } = await verifyPortabilityBackup(config, preview.backupId);
  if (!input.confirmed) throw new PortabilityError("RESTORE_CONFIRMATION_REQUIRED");
  if (preview.mode === "restore-to-staging") {
    assertStagingDestination(preview.targetRoot, library.rootPath, config); await mkdir(preview.targetRoot, { recursive: true }); const created: string[] = []; let applied = 0;
    try { for (const operation of preview.operations.filter((item) => item.type === "create" || item.type === "replace")) { const content = files.get(`files/${operation.path}`.toLocaleLowerCase("en-US")); if (!content) throw new PortabilityError("BACKUP_INVALID"); const target = await assertConfinedPath(preview.targetRoot, operation.path, true); await atomicWriteBuffer(target, content); if (sha256(await readFile(target)) !== operation.backupSha256) throw new PortabilityError("RESTORE_FAILED"); created.push(operation.path); applied += 1; if (options.failAfterOperations === applied) throw new Error("Échec simulé."); }
      await rm(restoreSessionPath(config, preview.restoreId), { force: true }); await appendPortabilityHistory(config.statePath, { schemaVersion: 1, eventId: randomUUID(), event: "restore-success", timestamp: now.toISOString(), relatedId: preview.restoreId, status: "staging", relativePaths: created }); return { restoreId: preview.restoreId, status: "success", mode: preview.mode, filesCreated: created, filesReplaced: [], filesArchived: [] };
    } catch (error) { for (const relativePath of created.reverse()) await rm(path.join(preview.targetRoot, ...relativePath.split("/")), { force: true }); await appendPortabilityHistory(config.statePath, { schemaVersion: 1, eventId: randomUUID(), event: "restore-failed", timestamp: now.toISOString(), relatedId: preview.restoreId, status: "staging" }); throw error; }
  }
  if (input.confirmationText !== "RESTAURER") throw new PortabilityError("RESTORE_CONFIRMATION_REQUIRED"); if (path.resolve(preview.targetRoot) !== path.resolve(library.rootPath)) throw new PortabilityError("RESTORE_PREVIEW_REQUIRED"); await assertPortabilityWriteAllowed(environment, { now, wait: options.wait });
  const identity = await loadMachineIdentity(config); if (!identity) throw new PortabilityError("PORTABILITY_NOT_CONFIGURED"); const preBackup = await createPortabilityBackup(library.rootPath, config, identity, "before-write", { now, trigger: "restore", relatedId: preview.restoreId }); let lock: Awaited<ReturnType<typeof acquireImportLock>> | null = null; const before = new Map<string, Buffer | null>(); const created: string[] = []; const replaced: string[] = []; const archived: string[] = [];
  try {
    lock = await acquireImportLock(library.rootPath, preview.restoreId, now); const controlledBase = await assertPortabilityWriteAllowed(environment, { now, wait: options.wait, requireRecentBackup: true, verifiedBackupId: preBackup.backupId }); let applied = 0;
    const writes = preview.operations.filter((item) => item.type === "create" || item.type === "replace"); for (const operation of writes) { const target = await assertConfinedPath(library.rootPath, operation.path, true); let old: Buffer | null = null; try { old = await readFile(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } before.set(operation.path, old); const content = files.get(`files/${operation.path}`.toLocaleLowerCase("en-US")); if (!content) throw new PortabilityError("BACKUP_INVALID"); await atomicWriteBuffer(target, content); (old ? replaced : created).push(operation.path); applied += 1; if (options.failAfterOperations === applied) throw new Error("Échec simulé."); }
    if (preview.mirror) for (const operation of preview.operations.filter((item) => item.type === "delete-candidate")) { const target = await assertConfinedPath(library.rootPath, operation.path); const old = await readFile(target); before.set(operation.path, old); await rm(target, { force: true }); archived.push(operation.path); }
    if (!controlledBase.snapshot) throw new PortabilityError("CONTROLLED_STATE_UPDATE_FAILED");
    await recordSuccessfulKnowledgeWrite("restore", environment, { restoreId: preview.restoreId, expectedPaths: [...created, ...replaced, ...archived], baseSnapshot: controlledBase.snapshot, now, wait: options.wait, failBaselineWrite: options.failBaselineWrite });
    await rm(restoreSessionPath(config, preview.restoreId), { force: true }).catch(() => undefined);
    await appendPortabilityHistory(config.statePath, { schemaVersion: 1, eventId: randomUUID(), event: "restore-success", timestamp: now.toISOString(), machineId: identity.machineId, relatedId: preview.restoreId, status: "success", relativePaths: [...created, ...replaced, ...archived] }).catch(() => undefined);
    return { restoreId: preview.restoreId, status: "success", mode: preview.mode, preRestoreBackupId: preBackup.backupId, filesCreated: created, filesReplaced: replaced, filesArchived: archived };
  } catch {
    let rollbackFailed = false; try { if (options.failRollback) throw new Error("Échec rollback simulé."); for (const [relativePath, content] of [...before.entries()].reverse()) { const target = path.join(library.rootPath, ...relativePath.split("/")); if (content === null) await rm(target, { force: true }); else await atomicWriteBuffer(target, content); if (content && sha256(await readFile(target)) !== sha256(content)) throw new Error("Rollback invalide."); } } catch { rollbackFailed = true; }
    const status = rollbackFailed ? "rollback-failed" : "rolled-back"; await appendPortabilityHistory(config.statePath, { schemaVersion: 1, eventId: randomUUID(), event: rollbackFailed ? "restore-failed" : "restore-rolled-back", timestamp: now.toISOString(), machineId: identity.machineId, relatedId: preview.restoreId, status, relativePaths: [...created, ...replaced, ...archived] }); return { restoreId: preview.restoreId, status, mode: preview.mode, preRestoreBackupId: preBackup.backupId, filesCreated: created, filesReplaced: replaced, filesArchived: archived };
  } finally { if (lock) await lock.release(); }
}
