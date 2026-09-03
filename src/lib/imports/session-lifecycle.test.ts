import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { applyImport } from "@/lib/imports/apply";
import { readImportHistory } from "@/lib/imports/history";
import { previewImport, resumeImportPreview } from "@/lib/imports/preview";
import { readImportSession } from "@/lib/imports/sessions";
import { makeVault, packageZip } from "@/lib/imports/test-utils";
import { createCheckpoint } from "@/lib/portability/checkpoints";
import { getPortabilityConfig } from "@/lib/portability/config";
import { ensureMachineIdentity } from "@/lib/portability/machine-identity";
import { createVaultSnapshot } from "@/lib/portability/snapshots";
import { acquireWriterAuthority, reacquireWriterAuthority } from "@/lib/portability/writer-authority";
import { loadWorkflow, saveWorkflow } from "@/lib/workflows/runtime";

const roots: string[] = [];

async function isolated() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-apply-lifecycle-"));
  roots.push(root);
  const vault = path.join(root, "vault");
  const sessions = path.join(root, "sessions");
  await makeVault(vault);
  return { root, vault, sessions, environment: { YOUTUBE_LIBRARY_PATH: vault } };
}

async function portable() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-apply-writer-"));
  roots.push(root);
  const oneDrive = path.join(root, "OneDrive");
  const vault = path.join(oneDrive, "vault");
  const sessions = path.join(root, "sessions");
  await makeVault(vault);
  const environment = {
    YOUTUBE_LIBRARY_PATH: vault,
    TUBEKNOWLEDGE_ONEDRIVE_ROOT: oneDrive,
    TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(root, "state"),
    TUBEKNOWLEDGE_BACKUP_PATH: path.join(root, "portability-backups"),
    TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0",
  };
  const config = getPortabilityConfig(environment);
  const identity = await ensureMachineIdentity(config, { machineId: "11111111-1111-4111-8111-111111111111", now: new Date("2026-07-27T12:00:00Z") });
  const snapshot = await createVaultSnapshot(vault, identity.machineId, { now: new Date("2026-07-27T12:00:00Z") });
  const checkpoint = await createCheckpoint(vault, snapshot, "backup", { now: new Date("2026-07-27T12:00:00Z") });
  await acquireWriterAuthority(vault, identity, checkpoint, 30, { now: new Date("2026-07-27T12:00:00Z"), force: true, verifiedBackupId: "fixture", confirmationText: "REPRENDRE" });
  return { root, vault, sessions, environment, identity, checkpoint };
}

async function backupCount(vault: string): Promise<number> {
  try { return (await readdir(path.join(vault, ".backups", "imports"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).length; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("cycle de vie persistant des sessions Apply", () => {
  it("reproduit le 409 writer expiré, conserve la session puis réussit après réacquisition", async () => {
    const f = await portable();
    const zip = await packageZip();
    const preview = await previewImport(zip, { environment: f.environment, sessionRoot: f.sessions, now: new Date("2026-07-27T12:45:00Z") });

    const blocked = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment: f.environment, sessionRoot: f.sessions, now: new Date("2026-07-27T13:00:00Z") });

    expect(blocked).toMatchObject({ status: "rejected", sessionStatus: "failed", backupId: null, filesCreated: [], failure: { code: "WRITER_EXPIRED_LOCAL", retryable: true, requiresNewPreview: false } });
    expect(await readImportSession(preview.sessionId, f.sessions, new Date("2026-07-27T13:00:00Z"))).toMatchObject({ status: "failed" });
    expect(await backupCount(f.vault)).toBe(0);
    expect((await readImportHistory(f.vault)).filter((entry) => entry.status === "success")).toHaveLength(0);
    await expect(stat(path.join(f.vault, "01_BIBLIOTHEQUE", "Test", "notion.md"))).rejects.toThrow();

    await reacquireWriterAuthority(f.vault, f.identity, f.checkpoint, 30, new Date("2026-07-27T13:01:00Z"));
    const applied = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment: f.environment, sessionRoot: f.sessions, now: new Date("2026-07-27T13:02:00Z") });
    expect(applied.status, JSON.stringify(applied)).toBe("success");
    expect(applied).toMatchObject({ sessionStatus: "applied", idempotent: false });
    expect(await readFile(path.join(f.vault, "01_BIBLIOTHEQUE", "Test", "notion.md"), "utf8")).toContain("Contenu sûr");
  });

  it("garde une erreur de backup pré-écriture récupérable puis réutilise la même session", async () => {
    const f = await isolated();
    const preview = await previewImport(await packageZip(), { environment: f.environment, sessionRoot: f.sessions });
    const failed = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment: f.environment, sessionRoot: f.sessions, failBackup: true });
    expect(failed).toMatchObject({ status: "rejected", failure: { code: "BACKUP_FAILED", retryable: true } });
    expect(await backupCount(f.vault)).toBe(0);
    const applied = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment: f.environment, sessionRoot: f.sessions });
    expect(applied.status).toBe("success");
  });

  it("sérialise un double clic et ne crée qu’une transaction", async () => {
    const f = await isolated();
    const preview = await previewImport(await packageZip(), { environment: f.environment, sessionRoot: f.sessions });
    const attempts = await Promise.allSettled([
      applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment: f.environment, sessionRoot: f.sessions }),
      applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment: f.environment, sessionRoot: f.sessions }),
    ]);
    expect(attempts.some((attempt) => attempt.status === "fulfilled" && attempt.value.status === "success")).toBe(true);
    for (const attempt of attempts) if (attempt.status === "rejected") expect(attempt.reason).toMatchObject({ code: "SESSION_APPLY_IN_PROGRESS" });
    expect(await backupCount(f.vault)).toBe(1);
    expect((await readImportHistory(f.vault)).filter((entry) => entry.status === "success")).toHaveLength(1);
  });

  it("rollback complètement puis permet une reprise documentée", async () => {
    const f = await isolated();
    const preview = await previewImport(await packageZip(), { environment: f.environment, sessionRoot: f.sessions });
    const rolledBack = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment: f.environment, sessionRoot: f.sessions, failAfterOperations: 1 });
    expect(rolledBack).toMatchObject({ status: "rolled-back", failure: { code: "TRANSACTION_ROLLED_BACK", rollbackCompleted: true, retryable: true } });
    await expect(stat(path.join(f.vault, "01_BIBLIOTHEQUE", "Test", "notion.md"))).rejects.toThrow();
    const applied = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment: f.environment, sessionRoot: f.sessions });
    expect(applied.status).toBe("success");
  });

  it("rejoue un succès de manière idempotente sans backup ni historique supplémentaire", async () => {
    const f = await isolated();
    const preview = await previewImport(await packageZip(), { environment: f.environment, sessionRoot: f.sessions });
    const first = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment: f.environment, sessionRoot: f.sessions });
    const firstContent = await readFile(path.join(f.vault, "01_BIBLIOTHEQUE", "Test", "notion.md"), "utf8");
    const repeated = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment: f.environment, sessionRoot: f.sessions });
    expect(repeated).toMatchObject({ status: "success", importId: first.importId, backupId: first.backupId, idempotent: true });
    expect(await readFile(path.join(f.vault, "01_BIBLIOTHEQUE", "Test", "notion.md"), "utf8")).toBe(firstContent);
    expect(await backupCount(f.vault)).toBe(1);
    expect((await readImportHistory(f.vault)).filter((entry) => entry.status === "success")).toHaveLength(1);
  });

  it("reprend après rafraîchissement et après réouverture du stockage de sessions", async () => {
    const f = await isolated();
    const preview = await previewImport(await packageZip(), { environment: f.environment, sessionRoot: f.sessions });
    const resumed = await resumeImportPreview(preview.sessionId, { environment: f.environment, sessionRoot: f.sessions });
    expect(resumed).toMatchObject({ sessionId: preview.sessionId, sessionStatus: "ready", canApply: true });
    expect((await readImportSession(preview.sessionId, f.sessions)).id).toBe(preview.sessionId);
    expect((await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment: f.environment, sessionRoot: f.sessions })).status).toBe("success");
  });

  it("conserve le workflow et ses artefacts lors d’un échec puis le finalise après succès", async () => {
    const f = await isolated();
    const runtime = path.join(f.root, "runtime");
    const packageRoot = path.join(runtime, "chatgpt-packages");
    const workflowRoot = path.join(runtime, "video-knowledge-workflows");
    const acquisitionRoot = path.join(runtime, "acquisitions", "fixture");
    await mkdir(acquisitionRoot, { recursive: true });
    await writeFile(path.join(acquisitionRoot, "transcript.txt"), "transcription conservée", "utf8");
    const preview = await previewImport(await packageZip(), { environment: f.environment, sessionRoot: f.sessions, origin: { type: "chatgpt-package", packageId: "123e4567-e89b-42d3-a456-426614174000", runtimeRoot: packageRoot } });
    await saveWorkflow({ schemaVersion: 1, workflowId: "22222222-2222-4222-8222-222222222222", createdAt: "2026-07-27T12:00:00Z", updatedAt: "2026-07-27T12:00:00Z", state: "preview-ready", sourceUrl: "https://www.youtube.com/watch?v=test123", packageId: "123e4567-e89b-42d3-a456-426614174000", previewSessionId: preview.sessionId, nextAction: "Confirmer", reprocessingApproved: false, knowledgePaths: [] }, workflowRoot);

    const failed = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment: f.environment, sessionRoot: f.sessions, failBackup: true });
    expect(failed.status).toBe("rejected");
    const waiting = await loadWorkflow("22222222-2222-4222-8222-222222222222", workflowRoot);
    expect(waiting).toMatchObject({ state: "preview-ready", previewSessionId: preview.sessionId });
    expect(waiting).not.toHaveProperty("importId");
    expect(await readFile(path.join(acquisitionRoot, "transcript.txt"), "utf8")).toBe("transcription conservée");

    const applied = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment: f.environment, sessionRoot: f.sessions });
    expect(await loadWorkflow("22222222-2222-4222-8222-222222222222", workflowRoot)).toMatchObject({ state: "imported", importId: applied.importId, knowledgePaths: ["01_BIBLIOTHEQUE/Test/notion.md"] });
  });

  it("distingue une session expirée et permet de recréer une Preview avec le même ZIP", async () => {
    const f = await isolated();
    const zip = await packageZip();
    const expired = await previewImport(zip, { environment: f.environment, sessionRoot: f.sessions, now: new Date("2026-07-27T12:00:00Z") });
    await expect(applyImport({ sessionId: expired.sessionId, confirmed: true }, { environment: f.environment, sessionRoot: f.sessions, now: new Date("2026-07-27T12:31:00Z") })).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    const recreated = await previewImport(zip, { environment: f.environment, sessionRoot: f.sessions, now: new Date("2026-07-27T12:31:00Z") });
    expect(recreated.sessionId).not.toBe(expired.sessionId);
    expect((await applyImport({ sessionId: recreated.sessionId, confirmed: true }, { environment: f.environment, sessionRoot: f.sessions, now: new Date("2026-07-27T12:32:00Z") })).status).toBe("success");
  });

  it("distingue un snapshot de cible obsolète et exige une nouvelle Preview", async () => {
    const f = await isolated();
    const zip = await packageZip();
    const preview = await previewImport(zip, { environment: f.environment, sessionRoot: f.sessions });
    const target = path.join(f.vault, "01_BIBLIOTHEQUE", "Test", "notion.md");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "création concurrente", "utf8");
    const conflict = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment: f.environment, sessionRoot: f.sessions });
    expect(conflict).toMatchObject({ status: "conflict", failure: { code: "TARGET_CHANGED", requiresNewPreview: true } });
    await expect(applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment: f.environment, sessionRoot: f.sessions })).rejects.toMatchObject({ code: "SESSION_REQUIRES_NEW_PREVIEW" });
    expect(await readFile(target, "utf8")).toBe("création concurrente");
    await rm(target);
    const recreated = await previewImport(zip, { environment: f.environment, sessionRoot: f.sessions });
    expect((await applyImport({ sessionId: recreated.sessionId, confirmed: true }, { environment: f.environment, sessionRoot: f.sessions })).status).toBe("success");
  });
});
