import { mkdtemp, mkdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyImport } from "@/lib/imports/apply";
import { atomicWrite, assertSafeTarget } from "@/lib/imports/filesystem";
import { readImportHistory } from "@/lib/imports/history";
import { sha256 } from "@/lib/imports/hash";
import { acquireImportLock } from "@/lib/imports/lock";
import { previewImport, resumeImportPreview } from "@/lib/imports/preview";
import { createImportSession, readImportSession } from "@/lib/imports/sessions";
import { makeVault, packageZip, validManifest } from "@/lib/imports/test-utils";
import { buildLibraryTree } from "@/lib/library/library-reader";
import { searchLibrary } from "@/lib/search/search";

describe("preview, transaction et journalisation", () => {
  let rootPath: string;
  let sessionRoot: string;
  let environment: { YOUTUBE_LIBRARY_PATH: string };

  beforeEach(async () => {
    rootPath = await mkdtemp(path.join(os.tmpdir(), "tk-import-vault-"));
    sessionRoot = await mkdtemp(path.join(os.tmpdir(), "tk-import-sessions-"));
    environment = { YOUTUBE_LIBRARY_PATH: rootPath };
    await makeVault(rootPath);
  });
  afterEach(async () => { await rm(rootPath, { recursive: true, force: true }); await rm(sessionRoot, { recursive: true, force: true }); });

  it("prévisualise une création absente puis l’applique avec backup et historique", async () => {
    const preview = await previewImport(await packageZip(), { environment, sessionRoot });
    expect(preview.canApply).toBe(true); expect(preview.operations[0].status).toBe("valid");
    const result = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment, sessionRoot });
    expect(result.status).toBe("success");
    expect(await readFile(path.join(rootPath, "01_BIBLIOTHEQUE", "Test", "notion.md"), "utf8")).toContain("Contenu sûr");
    expect(result.backupId).toBeTruthy();
    expect((await readImportHistory(rootPath))[0]).toMatchObject({ status: "success", filesCreated: ["01_BIBLIOTHEQUE/Test/notion.md"] });
  });

  it("reprend une Preview après rafraîchissement et recalcule les conflits", async () => {
    const preview = await previewImport(await packageZip(), { environment, sessionRoot });
    await expect(resumeImportPreview(preview.sessionId, { environment, sessionRoot })).resolves.toMatchObject({ sessionId: preview.sessionId, canApply: true, review: expect.stringContaining("Revue") });
    const target = path.join(rootPath, "01_BIBLIOTHEQUE", "Test");
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "notion.md"), "création concurrente", "utf8");
    await expect(resumeImportPreview(preview.sessionId, { environment, sessionRoot })).resolves.toMatchObject({ canApply: false, operations: [{ status: "conflict" }] });
  });

  it("signale create existant", async () => {
    const target = path.join(rootPath, "01_BIBLIOTHEQUE", "Test"); await mkdir(target, { recursive: true }); await writeFile(path.join(target, "notion.md"), "existe", "utf8");
    const preview = await previewImport(await packageZip(), { environment, sessionRoot });
    expect(preview.canApply).toBe(false); expect(preview.operations[0].status).toBe("conflict");
  });

  it("valide replace avec le bon hash et sauvegarde l’original", async () => {
    const current = "# Ancien\n\nContenu initial.\n"; const next = "# Remplacé\n\nNouveau contenu.\n";
    const target = path.join(rootPath, "02_SOURCES"); await mkdir(target); await writeFile(path.join(target, "videos.md"), current, "utf8");
    const manifest = validManifest({ operations: [{ type: "replace", path: "02_SOURCES/videos.md", contentFile: "changes/replace/02_SOURCES/videos.md", expectedSha256: sha256(current), newSha256: sha256(next) }] });
    const preview = await previewImport(await packageZip(manifest), { environment, sessionRoot }); expect(preview.canApply).toBe(true);
    const result = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment, sessionRoot });
    expect(result.status).toBe("success");
    expect(await readFile(path.join(rootPath, ".backups", "imports", result.backupId!, "originals", "02_SOURCES", "videos.md"), "utf8")).toBe(current);
  });

  it("signale replace avec mauvais hash", async () => {
    await mkdir(path.join(rootPath, "02_SOURCES")); await writeFile(path.join(rootPath, "02_SOURCES", "videos.md"), "actuel", "utf8");
    const next = "# Remplacé\n\nNouveau contenu.\n";
    const manifest = validManifest({ operations: [{ type: "replace", path: "02_SOURCES/videos.md", contentFile: "changes/replace/02_SOURCES/videos.md", expectedSha256: "a".repeat(64), newSha256: sha256(next) }] });
    const preview = await previewImport(await packageZip(manifest), { environment, sessionRoot }); expect(preview.operations[0].status).toBe("conflict");
  });

  it("refuse un remplacement dont le contenu ne change pas", async () => {
    const current = "# Remplacé\n\nNouveau contenu.\n";
    await mkdir(path.join(rootPath, "02_SOURCES")); await writeFile(path.join(rootPath, "02_SOURCES", "videos.md"), current, "utf8");
    const manifest = validManifest({ operations: [{ type: "replace", path: "02_SOURCES/videos.md", contentFile: "changes/replace/02_SOURCES/videos.md", expectedSha256: sha256(current), newSha256: sha256(current) }] });
    const preview = await previewImport(await packageZip(manifest), { environment, sessionRoot });
    expect(preview.canApply).toBe(false);
    const result = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment, sessionRoot });
    expect(result.status).toBe("conflict");
  });

  it("détecte un fichier modifié après preview sans l’écraser", async () => {
    const preview = await previewImport(await packageZip(), { environment, sessionRoot });
    const target = path.join(rootPath, "01_BIBLIOTHEQUE", "Test"); await mkdir(target, { recursive: true }); await writeFile(path.join(target, "notion.md"), "concurrent", "utf8");
    const result = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment, sessionRoot });
    expect(result.status).toBe("conflict"); expect(await readFile(path.join(target, "notion.md"), "utf8")).toBe("concurrent");
    expect((await readImportHistory(rootPath))[0].status).toBe("conflict");
  });

  it("rollback une création et un remplacement après échec", async () => {
    const current = "# Ancien\n"; const createContent = "# Nouvelle notion\n\nContenu sûr.\n"; const replaceContent = "# Remplacé\n\nNouveau contenu.\n";
    await mkdir(path.join(rootPath, "02_SOURCES")); await writeFile(path.join(rootPath, "02_SOURCES", "videos.md"), current, "utf8");
    const base = validManifest();
    const manifest = validManifest({ operations: [base.operations[0], { type: "replace", path: "02_SOURCES/videos.md", contentFile: "changes/replace/02_SOURCES/videos.md", expectedSha256: sha256(current), newSha256: sha256(replaceContent) }] });
    expect(base.operations[0].newSha256).toBe(sha256(createContent));
    const preview = await previewImport(await packageZip(manifest), { environment, sessionRoot });
    const result = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment, sessionRoot, failAfterOperations: 2 });
    expect(result.status).toBe("rolled-back");
    await expect(stat(path.join(rootPath, "01_BIBLIOTHEQUE", "Test", "notion.md"))).rejects.toThrow();
    expect(await readFile(path.join(rootPath, "02_SOURCES", "videos.md"), "utf8")).toBe(current);
  });

  it("signale rollback-failed lors d’un échec simulé", async () => {
    const preview = await previewImport(await packageZip(), { environment, sessionRoot });
    const result = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment, sessionRoot, failAfterOperations: 1, failRollback: true });
    expect(result.status).toBe("rollback-failed");
  });

  it("n’écrit aucune cible si la sauvegarde échoue", async () => {
    const preview = await previewImport(await packageZip(), { environment, sessionRoot });
    const result = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment, sessionRoot, failBackup: true });
    expect(result.status).toBe("rejected");
    await expect(stat(path.join(rootPath, "01_BIBLIOTHEQUE", "Test", "notion.md"))).rejects.toThrow();
    expect((await readImportHistory(rootPath))[0].status).toBe("rejected");
  });

  it("exige APPLIQUER pour une modification majeure", async () => {
    const manifest = validManifest({ structuralChange: { level: "major", confirmationRequired: true, summary: "Majeure" } });
    const preview = await previewImport(await packageZip(manifest), { environment, sessionRoot });
    await expect(applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment, sessionRoot })).rejects.toThrow("Confirmation");
    const result = await applyImport({ sessionId: preview.sessionId, confirmed: true, confirmationText: "APPLIQUER" }, { environment, sessionRoot });
    expect(result.status).toBe("success");
  });

  it("persiste le résultat appliqué et distingue une session expirée", async () => {
    const preview = await previewImport(await packageZip(), { environment, sessionRoot });
    const applied = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment, sessionRoot });
    await expect(readImportSession(preview.sessionId, sessionRoot)).resolves.toMatchObject({ status: "applied", result: { importId: applied.importId } });
    const expired = await createImportSession({ rootPath, manifest: validManifest(), operations: [] }, sessionRoot, new Date("2026-01-01T00:00:00Z"));
    await expect(readImportSession(expired.id, sessionRoot, new Date("2026-01-01T01:00:00Z"))).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("empêche un verrou simultané et remplace un verrou expiré", async () => {
    const first = await acquireImportLock(rootPath, "first", new Date());
    await expect(acquireImportLock(rootPath, "second", new Date())).rejects.toThrow("déjà en cours");
    await utimes(first.path, new Date(0), new Date(0));
    const replacement = await acquireImportLock(rootPath, "second", new Date());
    await replacement.release();
  });

  it("écrit atomiquement sans laisser de temporaire", async () => {
    const target = path.join(rootPath, "01_BIBLIOTHEQUE", "atomic.md"); await atomicWrite(target, "contenu");
    expect(await readFile(target, "utf8")).toBe("contenu");
    expect((await buildLibraryTree(rootPath)).length).toBeGreaterThan(0);
  });

  it("refuse un lien symbolique dans la cible", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "tk-import-outside-"));
    try { await mkdir(path.join(rootPath, "01_BIBLIOTHEQUE")); await symlink(outside, path.join(rootPath, "01_BIBLIOTHEQUE", "Lien"), "junction"); await expect(assertSafeTarget(rootPath, "01_BIBLIOTHEQUE/Lien/note.md", true)).rejects.toThrow("symbolique"); }
    finally { await rm(outside, { recursive: true, force: true }); }
  });

  it("ignore .backups et .tubeknowledge dans la lecture et la recherche", async () => {
    await mkdir(path.join(rootPath, ".backups")); await mkdir(path.join(rootPath, ".tubeknowledge"));
    await writeFile(path.join(rootPath, ".backups", "secret.md"), "motintrouvable", "utf8"); await writeFile(path.join(rootPath, ".tubeknowledge", "secret.md"), "motintrouvable", "utf8");
    const tree = await buildLibraryTree(rootPath); expect(tree.some((node) => node.name.startsWith("."))).toBe(false);
    expect(await searchLibrary({ q: "motintrouvable" }, environment)).toEqual([]);
  });
});
