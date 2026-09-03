import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { atomicWrite, assertSafeTarget } from "@/lib/imports/filesystem";
import { appendImportHistory } from "@/lib/imports/history";
import { sha256 } from "@/lib/imports/hash";
import { acquireImportLock } from "@/lib/imports/lock";
import { claimImportSession, readImportSession } from "@/lib/imports/sessions";
import type { ApplyResult, ImportFailure, ImportHistoryEntry, ImportStatus, StoredOperation } from "@/lib/imports/types";
import { recordSuccessfulKnowledgeWrite } from "@/lib/portability/integration";
import { assertPortabilityWriteAllowed } from "@/lib/portability/safety-gate";
import { PortabilityError } from "@/lib/portability/errors";

export type { ApplyResult } from "@/lib/imports/types";
export interface ApplyOptions { environment?: LibraryEnvironment; sessionRoot?: string; now?: Date; failBackup?: boolean; failAfterOperations?: number; failRollback?: boolean; failBaselineWrite?: boolean; wait?: (milliseconds: number) => Promise<void>; }

async function revalidate(rootPath: string, operations: StoredOperation[], manifestOperations: Array<{ newSha256: string }>): Promise<string[]> {
  const conflicts: string[] = [];
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    if (operation.newSha256 !== manifestOperations[index].newSha256.toLowerCase() || sha256(operation.content) !== operation.newSha256) conflicts.push(`${operation.path}: nouveau contenu invalide`);
    const target = await assertSafeTarget(rootPath, operation.path, operation.type === "create");
    try {
      const stats = await lstat(target);
      if (!stats.isFile() || stats.isSymbolicLink()) { conflicts.push(`${operation.path}: cible non régulière`); continue; }
      const currentHash = sha256(await readFile(target));
      if (operation.type === "create") conflicts.push(`${operation.path}: existe déjà`);
      else if (currentHash !== operation.beforeSha256 || currentHash !== operation.expectedSha256) conflicts.push(`${operation.path}: modifié depuis la prévisualisation`);
      else if (currentHash === operation.newSha256) conflicts.push(`${operation.path}: le contenu ne change pas`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        if (operation.type === "replace") conflicts.push(`${operation.path}: cible disparue`);
      } else throw error;
    }
  }
  return conflicts;
}

async function createBackup(rootPath: string, packageId: string, importId: string, operations: StoredOperation[], now: Date): Promise<{ id: string; directory: string }> {
  const id = `${now.toISOString().replace(/[:.]/g, "-")}-${packageId}-${importId}`;
  const directory = path.join(rootPath, ".backups", "imports", id);
  await mkdir(path.join(directory, "originals"), { recursive: true });
  for (const operation of operations) {
    if (operation.type === "replace" && operation.beforeContent !== null) {
      const backupTarget = path.join(directory, "originals", ...operation.path.split("/"));
      await mkdir(path.dirname(backupTarget), { recursive: true });
      await writeFile(backupTarget, operation.beforeContent, { encoding: "utf8", flag: "wx", mode: 0o600 });
    }
  }
  const manifest = {
    schemaVersion: 1, importId, packageId, createdAt: now.toISOString(), status: "prepared",
    operations: operations.map((operation) => ({ type: operation.type, path: operation.path, beforeSha256: operation.beforeSha256, afterSha256: operation.newSha256 })),
  };
  await writeFile(path.join(directory, "backup-manifest.json"), JSON.stringify(manifest, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { id, directory };
}

async function setBackupStatus(directory: string, status: ImportStatus): Promise<void> {
  const target = path.join(directory, "backup-manifest.json");
  const manifest = JSON.parse(await readFile(target, "utf8")) as Record<string, unknown>;
  manifest.status = status;
  await atomicWrite(target, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function removeEmptyParents(targetPath: string, rootPath: string): Promise<void> {
  let directory = path.dirname(targetPath);
  while (directory !== rootPath && directory.startsWith(`${rootPath}${path.sep}`)) {
    try { await rm(directory); } catch { break; }
    directory = path.dirname(directory);
  }
}

function classifyFailure(error: unknown, status: ImportStatus, message: string, now: Date): ImportFailure {
  if (error instanceof PortabilityError) {
    const requiresNewPreview = error.code === "CHECKPOINT_MISMATCH";
    const actions: Partial<Record<PortabilityError["code"], string>> = {
      WRITER_AUTHORITY_REQUIRED: "Acquérez writer sur cette machine, puis réessayez.",
      WRITER_EXPIRED_LOCAL: "Réacquérez writer sur cette machine, puis réessayez.",
      WRITER_EXPIRED_REMOTE: "Effectuez le handoff writer requis, puis réessayez.",
      WRITER_ACTIVE_ELSEWHERE: "Revenez sur la machine writer ou effectuez un handoff explicite.",
      CHECKPOINT_MISMATCH: "Prévalidez de nouveau le ZIP retourné après avoir stabilisé le vault.",
      CONTROLLED_WRITE_SCOPE_CHANGED: "Examinez la divergence additionnelle, puis prévalidez de nouveau le ZIP.",
      CONTROLLED_STATE_UPDATE_FAILED: "Réessayez la même session après avoir vérifié le stockage local de portabilité.",
      CONFLICTS_BLOCKING: "Résolvez les conflits bloquants, puis réessayez.",
      PLACEHOLDER_DETECTED: "Rendez les fichiers disponibles localement, puis réessayez.",
      VAULT_UNSTABLE: "Attendez que le vault soit stable localement, puis réessayez.",
      PORTABILITY_NOT_CONFIGURED: "Terminez la configuration de portabilité, puis réessayez.",
    };
    return { code: error.code, message: error.message, action: actions[error.code] ?? "Corrigez la condition de sécurité, puis réessayez.", retryable: !requiresNewPreview, requiresNewPreview, occurredAt: now.toISOString() };
  }
  if (status === "conflict") return { code: "TARGET_CHANGED", message, action: "Prévalidez de nouveau le ZIP retourné à partir de l’état actuel du vault.", retryable: false, requiresNewPreview: true, occurredAt: now.toISOString() };
  if (status === "rolled-back") return { code: "TRANSACTION_ROLLED_BACK", message, action: "La session reste disponible; corrigez la cause puis réessayez.", retryable: true, requiresNewPreview: false, occurredAt: now.toISOString(), rollbackCompleted: true };
  if (status === "rollback-failed") return { code: "ROLLBACK_FAILED", message, action: "Arrêtez les écritures et examinez le backup avant toute nouvelle Preview.", retryable: false, requiresNewPreview: true, occurredAt: now.toISOString(), rollbackCompleted: false };
  if (message.includes("autre import est déjà en cours")) return { code: "APPLY_IN_PROGRESS", message, action: "Attendez la transaction en cours, puis réessayez.", retryable: true, requiresNewPreview: false, occurredAt: now.toISOString() };
  if (message.includes("sauvegarde")) return { code: "BACKUP_FAILED", message, action: "Corrigez l’accès au backup, puis réessayez avec la même session.", retryable: true, requiresNewPreview: false, occurredAt: now.toISOString() };
  if (message.includes("vault configuré a changé")) return { code: "VAULT_CHANGED", message, action: "Rétablissez le vault attendu ou prévalidez de nouveau le ZIP retourné.", retryable: false, requiresNewPreview: true, occurredAt: now.toISOString() };
  return { code: "APPLY_REJECTED", message, action: "Corrigez la condition signalée, puis réessayez.", retryable: true, requiresNewPreview: false, occurredAt: now.toISOString() };
}

export async function applyImport(input: { sessionId: string; confirmed: boolean; confirmationText?: string }, options: ApplyOptions = {}): Promise<ApplyResult> {
  const started = Date.now();
  const now = options.now ?? new Date();
  const config = parseLibraryConfig(options.environment ?? process.env);
  if (!config.ok) throw new Error(config.message);
  const inputSession = await readImportSession(input.sessionId, options.sessionRoot, now);
  const requiresStrong = inputSession.manifest.structuralChange.level === "major" || inputSession.manifest.structuralChange.confirmationRequired;
  if (!input.confirmed || (requiresStrong && input.confirmationText !== "APPLIQUER")) throw new Error("Confirmation explicite requise.");
  const importId = randomUUID();
  const claim = await claimImportSession(input.sessionId, importId, options.sessionRoot, now);
  if (claim.replay) return { ...claim.replay, idempotent: true };
  const session = claim.session;
  const portabilityConflictId = session.origin?.type === "portability-conflict" ? session.origin.conflictId : undefined;
  let lock: Awaited<ReturnType<typeof acquireImportLock>> | null = null;
  let backup: { id: string; directory: string } | null = null;
  const created: string[] = [];
  const replaced: string[] = [];
  let status: ImportStatus = "rejected";
  let message = "Import rejeté.";
  let conflicts: string[] = [];
  let caughtError: unknown = null;
  try {
    if (path.resolve(session.rootPath) !== path.resolve(config.rootPath)) throw new Error("Le vault configuré a changé.");
    await assertPortabilityWriteAllowed(options.environment ?? process.env, { allowConflictId: portabilityConflictId, now, wait: options.wait });
    lock = await acquireImportLock(config.rootPath, importId, now);
    conflicts = await revalidate(config.rootPath, session.operations, session.manifest.operations);
    if (conflicts.length) { status = "conflict"; message = "Conflit détecté avant écriture."; throw new Error(message); }
    if (options.failBackup) throw new Error("Échec de sauvegarde simulé.");
    backup = await createBackup(config.rootPath, session.manifest.packageId, importId, session.operations, now);
    conflicts = await revalidate(config.rootPath, session.operations, session.manifest.operations);
    if (conflicts.length) {
      status = "conflict";
      message = "Conflit détecté après la sauvegarde et avant écriture.";
      await setBackupStatus(backup.directory, status);
      throw new Error(message);
    }
    const controlledBase = await assertPortabilityWriteAllowed(options.environment ?? process.env, { allowConflictId: portabilityConflictId, now, wait: options.wait });
    let applied = 0;
    try {
      for (const operation of session.operations) {
        const target = await assertSafeTarget(config.rootPath, operation.path, operation.type === "create");
        await atomicWrite(target, operation.content);
        const finalHash = sha256(await readFile(target));
        if (finalHash !== operation.newSha256) throw new Error(`Vérification finale échouée : ${operation.path}`);
        (operation.type === "create" ? created : replaced).push(operation.path);
        applied += 1;
        if (options.failAfterOperations === applied) throw new Error("Échec simulé après écriture.");
      }
      if (controlledBase.enabled && !controlledBase.snapshot) throw new PortabilityError("CONTROLLED_STATE_UPDATE_FAILED");
      await recordSuccessfulKnowledgeWrite(portabilityConflictId ? "conflict-resolved" : "import", options.environment ?? process.env, {
        importId,
        conflictId: portabilityConflictId,
        conflictStatus: portabilityConflictId ? "resolved" : undefined,
        expectedPaths: session.operations.map((operation) => operation.path),
        baseSnapshot: controlledBase.snapshot!,
        now,
        wait: options.wait,
        failBaselineWrite: options.failBaselineWrite,
      });
      status = "success"; message = "Tous les changements confirmés ont été ajoutés.";
    } catch (applyError) {
      caughtError = applyError;
      let rollbackFailed = false;
      try {
        if (options.failRollback) throw new Error("Échec de rollback simulé.");
        for (const operation of [...session.operations].reverse()) {
          const target = path.join(config.rootPath, ...operation.path.split("/"));
          if (created.includes(operation.path)) { await rm(target, { force: true }); await removeEmptyParents(target, config.rootPath); }
          if (replaced.includes(operation.path) && operation.beforeContent !== null) {
            await atomicWrite(target, operation.beforeContent);
            if (sha256(await readFile(target)) !== operation.beforeSha256) throw new Error(`Restauration invalide : ${operation.path}`);
          }
        }
      } catch { rollbackFailed = true; }
      status = rollbackFailed ? "rollback-failed" : "rolled-back";
      message = rollbackFailed ? "L’import a échoué et la restauration est incomplète." : "L’import a échoué; l’état précédent a été restauré.";
      if (!(applyError instanceof Error)) message += " Erreur inconnue.";
    }
    await setBackupStatus(backup.directory, status);
  } catch (error) {
    caughtError = error;
    if (status !== "conflict") message = error instanceof Error ? error.message : message;
  } finally {
    if (lock) await lock.release();
  }
  try {
    const failure = status === "success" ? undefined : classifyFailure(caughtError, status, message, now);
    const history: ImportHistoryEntry = { importId, packageId: session.manifest.packageId, timestamp: now.toISOString(), source: session.manifest.source, status, structuralChange: session.manifest.structuralChange, filesCreated: created, filesReplaced: replaced, conflicts, backupId: backup?.id ?? null, durationMs: Date.now() - started, message };
    await appendImportHistory(config.rootPath, history);
    if (session.origin?.type === "chatgpt-package") {
      try {
        const { updatePackageStatus } = await import("@/lib/chatgpt-packages/runtime");
        if (status === "success") await updatePackageStatus(session.origin.packageId, "imported", { event: "import-success", importId, backupId: backup?.id }, session.origin.runtimeRoot);
        else await updatePackageStatus(session.origin.packageId, "result-previewed", { event: "import-failed", importId, backupId: backup?.id, lastError: message }, session.origin.runtimeRoot);
      } catch {
        // La traçabilité locale ne doit jamais masquer le résultat transactionnel Phase 3.
      }
      try {
        const { attachPreviewToWorkflow, findWorkflowByPackageId, markWorkflowImported } = await import("@/lib/workflows/orchestrator");
        const workflowRoot = session.origin.runtimeRoot ? path.join(path.dirname(session.origin.runtimeRoot), "video-knowledge-workflows") : undefined;
        const workflow = await findWorkflowByPackageId(session.origin.packageId, { environment: options.environment, root: workflowRoot, now: () => now });
        if (workflow) {
          if (status === "success") await markWorkflowImported(workflow.workflowId, { importId }, { environment: options.environment, root: workflowRoot, now: () => now });
          else await attachPreviewToWorkflow(workflow.workflowId, { previewSessionId: session.id, canApply: !failure?.requiresNewPreview }, { environment: options.environment, root: workflowRoot, now: () => now });
        }
      } catch {
        // L’historique d’import demeure la preuve de commit et permet une resynchronisation du workflow.
      }
    }
    const result: ApplyResult = { status, sessionStatus: status === "success" ? "applied" : "failed", importId, backupId: backup?.id ?? null, filesCreated: created, filesReplaced: replaced, message, idempotent: false, failure };
    if (status === "success") await claim.markApplied(result);
    else await claim.markFailed(failure!);
    return result;
  } finally {
    await claim.release();
  }
}
