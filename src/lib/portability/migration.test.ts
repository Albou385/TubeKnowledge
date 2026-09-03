import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import yazl from "yazl";
import { afterEach, describe, expect, it } from "vitest";

import { sha256 } from "@/lib/imports/hash";

import { MIGRATION_ROOT, migrationManifestSchema, parseMigrationArchive, validateMigrationArchiveEntryName } from "./migration-archive";
import {
  exportColdMigrationBundle,
  importColdMigrationBundle,
  MIGRATION_IMPORT_CONFIRMATION,
  previewColdMigrationImport,
} from "./migration";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function zip(files: Array<{ path: string; content: Buffer | string; mode?: number }>): Promise<Buffer> {
  const archive = new yazl.ZipFile();
  for (const file of files) archive.addBuffer(Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content), file.path, { mode: file.mode });
  archive.end();
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    archive.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.once("error", reject);
    archive.outputStream.once("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-migration-"));
  temporary.push(root);
  const runtime = path.join(root, "tower-runtime");
  const sessions = path.join(root, "tower-sessions");
  const output = path.join(root, "output");
  const acquisitionId = "11111111-1111-4111-8111-111111111111";
  const packageId = "22222222-2222-4222-8222-222222222222";
  const sessionId = "33333333-3333-4333-8333-333333333333";
  const sourceVault = path.join(root, "Tower", "vault");
  const sourcePackageRuntime = path.join(root, "Tower", "runtime", "chatgpt-packages");
  await mkdir(path.join(runtime, "video-queue"), { recursive: true });
  await mkdir(path.join(runtime, "video-knowledge-workflows"), { recursive: true });
  await mkdir(path.join(runtime, "acquisitions", acquisitionId, "output"), { recursive: true });
  await mkdir(path.join(runtime, "acquisitions", acquisitionId, "raw"), { recursive: true });
  await mkdir(path.join(runtime, "acquisitions", acquisitionId, "work"), { recursive: true });
  await mkdir(path.join(runtime, "acquisitions", acquisitionId, "logs"), { recursive: true });
  await mkdir(path.join(runtime, "chatgpt-packages", packageId), { recursive: true });
  await mkdir(path.join(runtime, "models"), { recursive: true });
  await mkdir(path.join(runtime, "library-assistant", "history"), { recursive: true });
  await mkdir(sessions, { recursive: true });
  await mkdir(output, { recursive: true });
  await writeFile(path.join(runtime, "video-queue", "queue-state.json"), JSON.stringify({ fixture: "queue" }), "utf8");
  await writeFile(path.join(runtime, "video-knowledge-workflows", `${acquisitionId}.json`), JSON.stringify({ fixture: "workflow" }), "utf8");
  await writeFile(path.join(runtime, "acquisitions", acquisitionId, "job.json"), JSON.stringify({ id: acquisitionId, artifacts: [{ name: "transcript.txt" }, { name: "segments.json" }] }), "utf8");
  await writeFile(path.join(runtime, "acquisitions", acquisitionId, "source.json"), JSON.stringify({ title: "Fixture" }), "utf8");
  await writeFile(path.join(runtime, "acquisitions", acquisitionId, "output", "transcript.txt"), "transcript utile", "utf8");
  await writeFile(path.join(runtime, "acquisitions", acquisitionId, "output", "segments.json"), "{}", "utf8");
  await writeFile(path.join(runtime, "acquisitions", acquisitionId, "raw", "upload.txt"), "source utile", "utf8");
  await writeFile(path.join(runtime, "acquisitions", acquisitionId, "work", "audio.wav"), "média lourd", "utf8");
  await writeFile(path.join(runtime, "acquisitions", acquisitionId, "logs", "events.jsonl"), "journal", "utf8");
  await writeFile(path.join(runtime, "models", "model.bin"), "modèle", "utf8");
  await writeFile(path.join(runtime, "chatgpt-packages", packageId, "package.json"), JSON.stringify({ packageId }), "utf8");
  await writeFile(path.join(runtime, "chatgpt-packages", packageId, "package.zip"), await zip([{ path: "request.md", content: "demande" }]));
  await writeFile(path.join(runtime, "library-assistant", "history", "history.jsonl"), "{}\n", "utf8");
  await writeFile(path.join(sessions, `${sessionId}.json`), JSON.stringify({
    id: sessionId,
    status: "failed",
    expiresAt: "2026-10-01T00:00:00.000Z",
    rootPath: sourceVault,
    origin: { type: "chatgpt-package", packageId, runtimeRoot: sourcePackageRuntime },
    failure: {
      code: "APPLY_FAILED",
      message: `EACCES pendant l’accès à ${path.join(sourceVault, "INDEX.md")}`,
      action: `Réessayez depuis ${sourcePackageRuntime}`,
      retryable: true,
      requiresNewPreview: false,
      occurredAt: "2026-08-12T12:00:00.000Z",
    },
    result: {
      status: "rolled-back",
      sessionStatus: "failed",
      importId: "44444444-4444-4444-8444-444444444444",
      backupId: null,
      filesCreated: [],
      filesReplaced: [],
      message: `Restauration après une erreur dans ${sourceVault}`,
      idempotent: false,
      failure: {
        code: "APPLY_FAILED",
        message: `Échec sous ${sourceVault}`,
        action: `Inspectez ${sourcePackageRuntime}`,
        retryable: true,
        requiresNewPreview: false,
        occurredAt: "2026-08-12T12:00:00.000Z",
      },
    },
  }), "utf8");
  return { root, runtime, sessions, output, acquisitionId, packageId, sessionId };
}

describe("bundle froid de migration", () => {
  it("exporte seulement les états utiles, avec checksums et sans média, modèle, log ou chemin Tour", async () => {
    const value = await fixture();
    const result = await exportColdMigrationBundle({ runtimePath: value.runtime, sessionPath: value.sessions, sourceRootHash: "a".repeat(64), gitCommit: "d7625b5", now: new Date("2026-08-12T13:00:00.000Z") });
    const parsed = await parseMigrationArchive(result.archive);
    const names = [...parsed.files.keys()];
    expect(names).toContain("runtime/video-queue/queue-state.json");
    expect(names).toContain(`runtime/acquisitions/${value.acquisitionId}/output/transcript.txt`);
    expect(names).toContain(`runtime/chatgpt-packages/${value.packageId}/package.zip`);
    expect(names).toContain(`apply-sessions/${value.sessionId}.json`);
    expect(names.some((name) => /models|audio\.wav|events\.jsonl|\/work\//i.test(name))).toBe(false);
    const portableSession = JSON.parse(parsed.files.get(`apply-sessions/${value.sessionId}.json`)!.toString("utf8")) as {
      rootPath: string;
      origin: { runtimeRoot: string };
    };
    expect(portableSession).toMatchObject({
      rootPath: "__TUBEKNOWLEDGE_MIGRATION_TARGET__",
      origin: { runtimeRoot: "__TUBEKNOWLEDGE_MIGRATION_TARGET__" },
    });
    expect(JSON.stringify(portableSession)).not.toContain(value.root);
    expect(parsed.manifest.files.every((file) => parsed.files.get(file.path)?.length === file.size && sha256(parsed.files.get(file.path)!) === file.sha256)).toBe(true);
  });

  it("prévisualise puis importe vers un runtime vide, réécrit les chemins locaux et rejoue idempotemment", async () => {
    const value = await fixture();
    const exported = await exportColdMigrationBundle({ runtimePath: value.runtime, sessionPath: value.sessions, sourceRootHash: "b".repeat(64), gitCommit: "d7625b5", now: new Date("2026-08-12T13:00:00.000Z") });
    const portableRuntime = path.join(value.root, "portable-runtime");
    const portableSessions = path.join(value.root, "portable-sessions");
    const portableBackups = path.join(value.root, "portable-backups");
    await mkdir(path.join(portableRuntime, "video-queue"), { recursive: true });
    const preview = await previewColdMigrationImport(exported.archive, { runtimePath: portableRuntime, sessionPath: portableSessions, backupPath: portableBackups });
    expect(preview).toMatchObject({ targetEmpty: true, canImport: true, requiresConfirmation: false, sourceRootHash: "b".repeat(64) });
    const first = await importColdMigrationBundle(exported.archive, { runtimePath: portableRuntime, sessionPath: portableSessions, backupPath: portableBackups, vaultPath: path.join(value.root, "Portable", "vault") });
    expect(first.idempotent).toBe(false);
    expect(await readFile(path.join(portableRuntime, "video-queue", "queue-state.json"), "utf8")).toContain("queue");
    const session = JSON.parse(await readFile(path.join(portableSessions, `${value.sessionId}.json`), "utf8")) as { rootPath: string; origin: { runtimeRoot: string } };
    expect(session.rootPath).toBe(path.join(value.root, "Portable", "vault"));
    expect(session.origin.runtimeRoot).toBe(path.join(portableRuntime, "chatgpt-packages"));
    const replay = await importColdMigrationBundle(exported.archive, { runtimePath: portableRuntime, sessionPath: portableSessions, backupPath: portableBackups, vaultPath: path.join(value.root, "Portable", "vault") });
    expect(replay).toMatchObject({ idempotent: true, bundleId: first.bundleId, imported: first.imported });
  });

  it("protège une cible non vide, crée un backup vérifié après confirmation et préserve les modèles", async () => {
    const value = await fixture();
    const exported = await exportColdMigrationBundle({ runtimePath: value.runtime, sessionPath: value.sessions, sourceRootHash: "c".repeat(64), gitCommit: "d7625b5" });
    const portableRuntime = path.join(value.root, "portable-runtime");
    const portableSessions = path.join(value.root, "portable-sessions");
    const portableBackups = path.join(value.root, "portable-backups");
    await mkdir(path.join(portableRuntime, "video-queue"), { recursive: true });
    await mkdir(path.join(portableRuntime, "models"), { recursive: true });
    await writeFile(path.join(portableRuntime, "video-queue", "queue-state.json"), "ancien", "utf8");
    await writeFile(path.join(portableRuntime, "models", "local.bin"), "préserver", "utf8");
    const portableVault = path.join(value.root, "Portable", "vault");
    await expect(importColdMigrationBundle(exported.archive, { runtimePath: portableRuntime, sessionPath: portableSessions, backupPath: portableBackups, vaultPath: portableVault })).rejects.toThrow(MIGRATION_IMPORT_CONFIRMATION);
    const imported = await importColdMigrationBundle(exported.archive, { runtimePath: portableRuntime, sessionPath: portableSessions, backupPath: portableBackups, vaultPath: portableVault, confirmationText: MIGRATION_IMPORT_CONFIRMATION });
    expect(imported.targetBackupPath).toBeTruthy();
    expect(await stat(imported.targetBackupPath!)).toBeTruthy();
    expect(await readFile(path.join(portableRuntime, "models", "local.bin"), "utf8")).toBe("préserver");
  });

  it("refuse checksum altéré et path traversal", async () => {
    const manifest = migrationManifestSchema.parse({
      schemaVersion: 1,
      bundleId: "44444444-4444-4444-8444-444444444444",
      createdAt: "2026-08-12T13:00:00.000Z",
      sourceRootHash: "d".repeat(64),
      gitCommit: "d7625b5",
      backupId: null,
      files: [{ path: "runtime/video-queue/queue-state.json", size: 4, sha256: sha256("bon!"), category: "queue" }],
      fileCount: 1,
      totalBytes: 4,
    });
    const altered = await zip([
      { path: `${MIGRATION_ROOT}/manifest.json`, content: `${JSON.stringify(manifest)}\n` },
      { path: `${MIGRATION_ROOT}/runtime/video-queue/queue-state.json`, content: "mal!" },
    ]);
    await expect(parseMigrationArchive(altered)).rejects.toThrow("Checksum");
    expect(() => validateMigrationArchiveEntryName(`${MIGRATION_ROOT}/../escape.txt`)).toThrow("dangereux");
    expect(() => validateMigrationArchiveEntryName(`${MIGRATION_ROOT}/C:/escape.txt`)).toThrow();
  });

  it("refuse collision de casse, lien symbolique et destinations dangereuses", async () => {
    const value = await fixture();
    const collision = await zip([
      { path: `${MIGRATION_ROOT}/runtime/video-queue/queue-state.json`, content: "a" },
      { path: `${MIGRATION_ROOT}/runtime/VIDEO-QUEUE/QUEUE-STATE.JSON`, content: "b" },
    ]);
    await expect(parseMigrationArchive(collision)).rejects.toThrow("collision de casse");
    const symlink = await zip([{ path: `${MIGRATION_ROOT}/runtime/link`, content: "target", mode: 0o120777 }]);
    await expect(parseMigrationArchive(symlink)).rejects.toThrow("lien symbolique");

    const exported = await exportColdMigrationBundle({ runtimePath: value.runtime, sessionPath: value.sessions, sourceRootHash: "f".repeat(64), gitCommit: "d7625b5" });
    await expect(previewColdMigrationImport(exported.archive, {
      runtimePath: "runtime-relatif",
      sessionPath: path.join(value.root, "sessions-target"),
      backupPath: path.join(value.root, "backups-target"),
    })).rejects.toThrow("absolu");
    const shared = path.join(value.root, "shared");
    await expect(previewColdMigrationImport(exported.archive, {
      runtimePath: shared,
      sessionPath: path.join(shared, "sessions"),
      backupPath: path.join(value.root, "backups-target"),
    })).rejects.toThrow("non imbriqués");
    const vault = path.join(value.root, "vault-target");
    await expect(importColdMigrationBundle(exported.archive, {
      runtimePath: path.join(vault, "runtime"),
      sessionPath: path.join(value.root, "sessions-target"),
      backupPath: path.join(value.root, "backups-target"),
      vaultPath: vault,
    })).rejects.toThrow("hors du vault");
  });

  it("refuse un secret potentiel avant de créer l’archive", async () => {
    const value = await fixture();
    await writeFile(path.join(value.runtime, "chatgpt-packages", value.packageId, "status.json"), "OPENAI_API_KEY=test-value", "utf8");
    await expect(exportColdMigrationBundle({ runtimePath: value.runtime, sessionPath: value.sessions, sourceRootHash: "e".repeat(64), gitCommit: "d7625b5" })).rejects.toThrow("secret potentiel");
    expect(await readdir(value.output)).toEqual([]);
  });
});
